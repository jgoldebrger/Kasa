import { Types } from 'mongoose'
import { EmailAutomationRule, Organization } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/log'
import { executeEmailAutomationRule } from '@/lib/route-logic/email-automation-rules/execute-rule'

const JOB_NAME = 'run-email-drips'

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
          const result = await executeEmailAutomationRule(orgId, rule)
          sent += result.sent
          failed += result.failed
          if (result.skipped) skipped++
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
