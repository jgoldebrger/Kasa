import { EmailAutomationRule } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { executeEmailAutomationRule } from '../execute-rule'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'POST /api/email-automation-rules/[id]/run',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-automation-rules-run',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rule = await EmailAutomationRule.findOne({
      _id: params.id,
      organizationId: ctx!.organizationId,
    }).lean<any>()

    if (!rule) {
      return { status: 404, data: { error: 'Email automation rule not found' } }
    }

    const result = await executeEmailAutomationRule(ctx!.organizationId, rule, { force: true })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_automation_rule.run',
      resourceType: 'EmailAutomationRule',
      resourceId: params.id as string,
      metadata: result,
      request,
    })

    return { data: result }
  },
})
