import { Types } from 'mongoose'
import { EmailAutomationRule, EmailTemplate, Family, LifecycleEventPayment } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import {
  sendEmail,
  applyMergeFields,
  loadMergeFieldContext,
  delayBetweenSendsMs,
  sleep,
} from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'

const MIN_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000

async function familiesForBalanceRule(organizationId: string): Promise<string[]> {
  const families = await Family.find({
    organizationId,
    email: { $exists: true, $ne: '' },
    communicationsOptOut: { $ne: true },
    emailFormatInvalid: { $ne: true },
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()

  const matching: string[] = []
  for (const fam of families) {
    const familyId = String(fam._id)
    try {
      const bal = await calculateFamilyBalance(familyId, organizationId)
      if (bal.balance > 0) matching.push(familyId)
    } catch {
      /* skip */
    }
  }
  return matching
}

async function familiesForEventRule(organizationId: string): Promise<string[]> {
  const now = new Date()
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const rows = await LifecycleEventPayment.find({
    organizationId,
    eventDate: { $gte: now, $lte: horizon },
    deletedAt: null,
  })
    .select('familyId')
    .lean<{ familyId?: Types.ObjectId }[]>()

  const familyIds = [...new Set(rows.map((r) => String(r.familyId)).filter(Boolean))]
  if (familyIds.length === 0) return []

  const eligible = await Family.find({
    organizationId,
    _id: { $in: familyIds },
    email: { $exists: true, $ne: '' },
    communicationsOptOut: { $ne: true },
    emailFormatInvalid: { $ne: true },
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()

  return eligible.map((f) => String(f._id))
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

  const familyIds =
    rule.ruleType === 'balance_gt_zero'
      ? await familiesForBalanceRule(organizationId)
      : await familiesForEventRule(organizationId)

  if (familyIds.length === 0) {
    await EmailAutomationRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() } })
    return { sent: 0, failed: 0, skipped: false }
  }

  const families = await Family.find({
    organizationId,
    _id: { $in: familyIds },
  }).lean<any[]>()
  const byId = new Map(families.map((f) => [String(f._id), f]))

  const pacingMs = delayBetweenSendsMs(familyIds.length)
  let sent = 0
  let failed = 0
  let sendIndex = 0

  for (const familyId of familyIds) {
    if (sendIndex > 0 && pacingMs > 0) await sleep(pacingMs)
    sendIndex++

    const family = byId.get(familyId)
    if (!family?.email || family.communicationsOptOut || family.emailFormatInvalid) continue

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
