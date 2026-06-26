import { Types } from 'mongoose'
import {
  EmailAutomationRule,
  EmailTemplate,
  Family,
  LifecycleEventPayment,
  Organization,
} from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import {
  sendEmail,
  applyMergeFields,
  loadMergeFieldContext,
  delayBetweenSendsMs,
  sleep,
} from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/log'

const JOB_NAME = 'run-email-drips'
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

async function runRuleForOrg(
  organizationId: string,
  rule: {
    _id: Types.ObjectId
    templateId: Types.ObjectId
    ruleType: 'balance_gt_zero' | 'event_within_30_days'
    lastRunAt?: Date | null
  },
): Promise<{ sent: number; failed: number; skipped: number }> {
  if (rule.lastRunAt && Date.now() - new Date(rule.lastRunAt).getTime() < MIN_RUN_INTERVAL_MS) {
    return { sent: 0, failed: 0, skipped: 1 }
  }

  const template = await EmailTemplate.findOne({
    _id: rule.templateId,
    organizationId,
  }).lean<{ subject?: string; html?: string; text?: string } | null>()
  if (!template?.subject || !template.html) {
    return { sent: 0, failed: 0, skipped: 1 }
  }

  const familyIds =
    rule.ruleType === 'balance_gt_zero'
      ? await familiesForBalanceRule(organizationId)
      : await familiesForEventRule(organizationId)

  if (familyIds.length === 0) {
    await EmailAutomationRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() } })
    return { sent: 0, failed: 0, skipped: 0 }
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

    const result = await sendEmail({
      organizationId,
      familyId,
      to: family.email,
      subject: template.subject,
      html,
      text,
      kind: 'custom',
      tracking: { opens: true, clicks: true },
    })

    if (result.ok) sent++
    else failed++
  }

  await EmailAutomationRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() } })
  return { sent, failed, skipped: 0 }
}

export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/run-email-drips',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-run-email-drips', {
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rules = await EmailAutomationRule.find({ enabled: true }).lean<any[]>()
    const orgIds = [...new Set(rules.map((r) => String(r.organizationId)))]

    let rulesProcessed = 0
    let sent = 0
    let failed = 0
    let skipped = 0

    for (const orgId of orgIds) {
      const org = await Organization.findById(orgId).select('_id').lean()
      if (!org) continue

      const orgRules = rules.filter((r) => String(r.organizationId) === orgId)
      for (const rule of orgRules) {
        rulesProcessed++
        try {
          const result = await runRuleForOrg(orgId, rule)
          sent += result.sent
          failed += result.failed
          skipped += result.skipped
        } catch (err) {
          failed++
          logError(err, {
            module: 'jobs.run-email-drips',
            organizationId: orgId,
            ruleId: String(rule._id),
          })
        }
      }
    }

    return { data: { ok: true, rulesProcessed, sent, failed, skipped } }
  },
})

export const GET = POST
