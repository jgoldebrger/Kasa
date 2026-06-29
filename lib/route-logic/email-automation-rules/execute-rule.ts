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

const MIN_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000

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
    ruleType: 'balance_gt_zero' | 'event_within_30_days'
    lastRunAt?: Date | null
  },
  opts?: { force?: boolean },
): Promise<ExecuteEmailAutomationRuleResult> {
  if (
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

  const recipients = await listAutomationRecipients(organizationId, rule.ruleType)

  if (recipients.length === 0) {
    await EmailAutomationRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() } })
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
  let sendIndex = 0

  for (const recipient of recipients) {
    if (sendIndex > 0 && pacingMs > 0) await sleep(pacingMs)
    sendIndex++

    const family = byId.get(recipient.id)
    if (!family?.email || family.communicationsOptOut || family.emailFormatInvalid) continue

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

  await EmailAutomationRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() } })
  return { sent, failed, skipped: false }
}
