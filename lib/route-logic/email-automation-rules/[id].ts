import { EmailAutomationRule, EmailTemplate } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailAutomationRule as emailAutomationRuleSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/email-automation-rules/[id]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-automation-rules-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rule = await EmailAutomationRule.findOne({
      _id: params.id,
      organizationId: ctx!.organizationId,
    }).lean()

    if (!rule) {
      return { status: 404, data: { error: 'Email automation rule not found' } }
    }

    return { data: rule }
  },
})

export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: emailAutomationRuleSchemas.emailAutomationRuleUpdateBody,
  name: 'PUT /api/email-automation-rules/[id]',
  fn: async ({ ctx, params, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-automation-rules-update',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if ('templateId' in body && body.templateId) {
      const template = await EmailTemplate.findOne({
        _id: body.templateId,
        organizationId: ctx!.organizationId,
      })
        .select('_id')
        .lean()
      if (!template) {
        return { status: 400, data: { error: 'Email template not found' } }
      }
    }

    const rule = await EmailAutomationRule.findOneAndUpdate(
      { _id: params.id, organizationId: ctx!.organizationId },
      { $set: body },
      { new: true, runValidators: true },
    )

    if (!rule) {
      return { status: 404, data: { error: 'Email automation rule not found' } }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_automation_rule.update',
      resourceType: 'EmailAutomationRule',
      resourceId: rule._id,
      metadata: { fields: Object.keys(body) },
      request,
    })

    return { data: rule }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/email-automation-rules/[id]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-automation-rules-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const deleted = await EmailAutomationRule.findOneAndDelete({
      _id: params.id,
      organizationId: ctx!.organizationId,
    }).lean<{ _id: unknown; name?: string } | null>()

    if (!deleted) {
      return { status: 404, data: { error: 'Email automation rule not found' } }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_automation_rule.delete',
      resourceType: 'EmailAutomationRule',
      resourceId: params.id as string,
      metadata: { name: deleted.name },
      request,
    })

    return { data: { ok: true } }
  },
})
