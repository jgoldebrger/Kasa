import { EmailTemplate } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailTemplate as emailTemplateSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/email-templates',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-templates-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rows = await EmailTemplate.find({ organizationId: ctx!.organizationId })
      .sort({ name: 1, _id: 1 })
      .lean<any[]>()

    return {
      data: {
        templates: rows.map((r) => ({
          _id: String(r._id),
          name: r.name,
          subject: r.subject,
          html: r.html,
          text: r.text ?? null,
          createdBy: r.createdBy ? String(r.createdBy) : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
    }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailTemplateSchemas.emailTemplateBody,
  name: 'POST /api/email-templates',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-templates-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const doc = await EmailTemplate.create({
      organizationId: ctx!.organizationId,
      name: body.name,
      subject: body.subject,
      html: body.html,
      text: body.text,
      createdBy: ctx!.userId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_template.create',
      resourceType: 'EmailTemplate',
      resourceId: doc._id,
      metadata: { name: body.name },
      request,
    })

    return {
      status: 201,
      data: {
        _id: String(doc._id),
        name: doc.name,
        subject: doc.subject,
        html: doc.html,
        text: doc.text ?? null,
        createdBy: String(doc.createdBy),
      },
    }
  },
})
