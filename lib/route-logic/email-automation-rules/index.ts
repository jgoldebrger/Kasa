import { EmailAutomationRule, EmailTemplate } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailAutomationRule as emailAutomationRuleSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { loadAllByIdCursor } from '@/lib/org-pagination'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/email-automation-rules',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-automation-rules-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rules = await loadAllByIdCursor(
      (filter, limit) =>
        EmailAutomationRule.find(filter).sort({ name: 1, _id: 1 }).limit(limit).lean(),
      { organizationId: ctx!.organizationId },
    )

    return { data: { rules } }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailAutomationRuleSchemas.emailAutomationRuleBody,
  name: 'POST /api/email-automation-rules',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-automation-rules-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const template = await EmailTemplate.findOne({
      _id: body.templateId,
      organizationId: ctx!.organizationId,
    })
      .select('_id')
      .lean()
    if (!template) {
      return { status: 400, data: { error: 'Email template not found' } }
    }

    const rule = await EmailAutomationRule.create({
      organizationId: ctx!.organizationId,
      name: body.name,
      enabled: body.enabled ?? false,
      templateId: body.templateId,
      ruleType: body.ruleType,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_automation_rule.create',
      resourceType: 'EmailAutomationRule',
      resourceId: rule._id,
      metadata: { name: body.name, ruleType: body.ruleType },
      request,
    })

    return { status: 201, data: rule }
  },
})
