import { Types } from 'mongoose'
import { EmailTemplate } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailTemplate as emailTemplateSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const PATCH = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: emailTemplateSchemas.emailTemplateUpdateBody,
  name: 'PATCH /api/email-templates/[id]',
  fn: async ({ ctx, params, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-templates-update',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid template id' } }
    }

    const updated = await EmailTemplate.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId },
      { $set: body },
      { new: true, runValidators: true },
    ).lean<any>()

    if (!updated) return { status: 404, data: { error: 'Template not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_template.update',
      resourceType: 'EmailTemplate',
      resourceId: id,
      metadata: { fields: Object.keys(body) },
      request,
    })

    return {
      data: {
        _id: String(updated._id),
        name: updated.name,
        category: updated.category ?? 'general',
        subject: updated.subject,
        html: updated.html,
        text: updated.text ?? null,
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/email-templates/[id]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-templates-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid template id' } }
    }

    const deleted = await EmailTemplate.findOneAndDelete({
      _id: id,
      organizationId: ctx!.organizationId,
    }).lean<{ _id: unknown; name?: string } | null>()

    if (!deleted) return { status: 404, data: { error: 'Template not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_template.delete',
      resourceType: 'EmailTemplate',
      resourceId: id,
      metadata: { name: deleted.name },
      request,
    })

    return { data: { ok: true } }
  },
})
