import { Types } from 'mongoose'
import { familyBatches } from '@/lib/org-pagination'
import { calculateFamilyBalance } from '@/lib/calculations'
import {
  sendEmail,
  applyMergeFields,
  loadMergeFieldContext,
  delayBetweenSendsMs,
  sleep,
} from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { qualifiesForDunning, canReceiveDunningEmail } from './qualify'
import { obligationStartDate } from './obligation'
import { planDunningAction, recordSuccessfulDunningSend } from './episodes'

export type DunningExecuteRule = {
  _id: Types.ObjectId
  templateId: Types.ObjectId
  minOwed: number
  daysSinceObligation: number
  maxAttempts: number
  intervalDays: number
}

type FamilyDoc = {
  _id: Types.ObjectId
  name?: string
  email?: string | null
  emailFormatInvalid?: boolean
  communicationsOptOut?: boolean
  createdAt: Date
}

export async function executeDunningArrearsRule(
  organizationId: string,
  rule: DunningExecuteRule,
  template: { subject: string; html: string; text?: string },
): Promise<{ sent: number; failed: number; skipped: number }> {
  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string } | null>()
  const timezone = org?.timezone

  let sent = 0
  let failed = 0
  let skipped = 0
  let sendIndex = 0

  for await (const batch of familyBatches(organizationId, {
    select: '_id name email emailFormatInvalid communicationsOptOut createdAt',
  })) {
    for (const raw of batch) {
      const family = raw as FamilyDoc
      const familyId = String(family._id)

      if (!canReceiveDunningEmail(family)) {
        skipped++
        continue
      }

      const { balance } = await calculateFamilyBalance(familyId, organizationId)
      const obligationStart = await obligationStartDate({
        organizationId,
        familyId,
        familyCreatedAt: family.createdAt,
      })
      const now = new Date()
      const qualifies = qualifiesForDunning({
        balance,
        minOwed: rule.minOwed,
        obligationStart,
        now,
        timezone,
        daysSinceObligation: rule.daysSinceObligation,
      })
      const planned = await planDunningAction({
        organizationId,
        familyId,
        rule: {
          _id: rule._id,
          maxAttempts: rule.maxAttempts,
          intervalDays: rule.intervalDays,
        },
        qualifies,
        now,
        timezone,
      })

      if (planned.action === 'skip' || planned.action === 'close') {
        skipped++
        continue
      }

      if (sendIndex > 0) {
        const pacingMs = delayBetweenSendsMs(sendIndex + 1)
        if (pacingMs > 0) await sleep(pacingMs)
      }
      sendIndex++

      const mergeCtx = await loadMergeFieldContext(familyId, organizationId)
      const html = applyMergeFields(template.html, mergeCtx).replace(
        /\{\{familyName\}\}/g,
        escapeHtml(family.name || ''),
      )
      const text = template.text
        ? applyMergeFields(template.text, mergeCtx).replace(
            /\{\{familyName\}\}/g,
            family.name || '',
          )
        : undefined
      const subject = applyMergeFields(template.subject, mergeCtx)

      const result = await sendEmail({
        organizationId,
        familyId,
        to: family.email!,
        subject,
        html,
        text,
        kind: 'custom',
        tracking: { opens: true, clicks: true },
      })

      if (result.ok) {
        const sentAt = new Date()
        await recordSuccessfulDunningSend({
          episodeId: planned.episodeId,
          now: sentAt,
          maxAttempts: rule.maxAttempts,
        })
        await audit({
          organizationId,
          action: 'email_automation_rule.dunning_send',
          resourceType: 'Family',
          resourceId: family._id,
          metadata: { ruleId: String(rule._id) },
        })
        sent++
      } else {
        failed++
      }
    }
  }

  return { sent, failed, skipped }
}
