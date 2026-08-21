import { Types } from 'mongoose'
import { EmailAutomationRule, EmailTemplate, Family } from '@/lib/models'
import {
  sendEmail,
  applyMergeFields,
  loadMergeFieldContext,
  delayBetweenSendsMs,
  sleep,
} from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { listAutomationRecipients } from './resolve-recipients'
import { executeDunningArrearsRule } from '@/lib/dunning/execute'

const MIN_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000

async function persistLastRunStats(
  ruleId: Types.ObjectId,
  stats: { sent: number; skipped: number; failed: number; error?: string | null },
) {
  await EmailAutomationRule.updateOne(
    { _id: ruleId },
    {
      $set: {
        lastRunAt: new Date(),
        lastRunSentCount: stats.sent,
        lastRunSkippedCount: stats.skipped,
        lastRunFailedCount: stats.failed,
        lastRunError: stats.error ?? null,
      },
    },
  )
}

export type ExecuteEmailAutomationRuleResult = {
  sent: number
  failed: number
  skipped: boolean
  reason?: string
}

export async function executeEmailAutomationRule(
  organizationId: string,
  rule: {
    _id: Types.ObjectId
    templateId: Types.ObjectId
    ruleType: 'balance_gt_zero' | 'event_within_30_days' | 'dunning_arrears'
    lastRunAt?: Date | null
    minOwed?: number | null
    daysSinceObligation?: number | null
    maxAttempts?: number | null
    intervalDays?: number | null
  },
  opts?: { force?: boolean },
): Promise<ExecuteEmailAutomationRuleResult> {
  if (
    rule.ruleType !== 'dunning_arrears' &&
    !opts?.force &&
    rule.lastRunAt &&
    Date.now() - new Date(rule.lastRunAt).getTime() < MIN_RUN_INTERVAL_MS
  ) {
    return { sent: 0, failed: 0, skipped: true, reason: 'Ran within the last 24 hours' }
  }

  const template = await EmailTemplate.findOne({
    _id: rule.templateId,
    organizationId,
  }).lean<{ subject?: string; html?: string; text?: string } | null>()
  if (!template?.subject || !template.html) {
    return { sent: 0, failed: 0, skipped: true, reason: 'Template missing subject or html' }
  }

  if (rule.ruleType === 'dunning_arrears') {
    const minOwed = rule.minOwed
    if (minOwed == null || minOwed <= 0) {
      await persistLastRunStats(rule._id, {
        sent: 0,
        skipped: 0,
        failed: 0,
        error: 'minOwed missing',
      })
      return { sent: 0, failed: 0, skipped: true, reason: 'minOwed missing' }
    }

    const stats = await executeDunningArrearsRule(
      organizationId,
      {
        _id: rule._id,
        templateId: rule.templateId,
        minOwed,
        daysSinceObligation: rule.daysSinceObligation ?? 30,
        maxAttempts: rule.maxAttempts ?? 3,
        intervalDays: rule.intervalDays ?? 7,
      },
      { subject: template.subject, html: template.html, text: template.text },
    )
    await persistLastRunStats(rule._id, stats)
    return { sent: stats.sent, failed: stats.failed, skipped: false }
  }

  const recipients = await listAutomationRecipients(organizationId, rule.ruleType)

  if (recipients.length === 0) {
    await persistLastRunStats(rule._id, { sent: 0, skipped: 0, failed: 0 })
    return { sent: 0, failed: 0, skipped: false }
  }

  const families = await Family.find({
    organizationId,
    _id: { $in: recipients.map((r) => r.id) },
  }).lean<any[]>()
  const byId = new Map(families.map((f) => [String(f._id), f]))

  const pacingMs = delayBetweenSendsMs(recipients.length)
  let sent = 0
  let failed = 0
  let skipped = 0
  let sendIndex = 0

  for (const recipient of recipients) {
    if (sendIndex > 0 && pacingMs > 0) await sleep(pacingMs)
    sendIndex++

    const family = byId.get(recipient.id)
    if (!family?.email || family.communicationsOptOut || family.emailFormatInvalid) {
      skipped++
      continue
    }

    const familyId = recipient.id
    const mergeCtx = await loadMergeFieldContext(familyId, organizationId)
    const html = applyMergeFields(template.html, mergeCtx).replace(
      /\{\{familyName\}\}/g,
      escapeHtml(family.name || ''),
    )
    const text = template.text
      ? applyMergeFields(template.text, mergeCtx).replace(/\{\{familyName\}\}/g, family.name || '')
      : undefined

    const subject = applyMergeFields(template.subject, mergeCtx)

    const result = await sendEmail({
      organizationId,
      familyId,
      to: family.email,
      subject,
      html,
      text,
      kind: 'custom',
      tracking: { opens: true, clicks: true },
    })

    if (result.ok) sent++
    else failed++
  }

  await persistLastRunStats(rule._id, { sent, skipped, failed })
  return { sent, failed, skipped: false }
}
