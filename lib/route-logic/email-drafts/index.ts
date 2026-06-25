import { EmailDraft } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailDraft as emailDraftSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/email-drafts',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-drafts-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rows = await EmailDraft.find({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean<any[]>()

    return {
      data: {
        drafts: rows.map((r) => ({
          _id: String(r._id),
          subject: r.subject ?? '',
          body: r.body ?? '',
          html: r.html ?? '',
          selectedFamilyIds: (r.selectedFamilyIds ?? []).map(String),
          userId: String(r.userId),
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
  body: emailDraftSchemas.emailDraftBody,
  name: 'POST /api/email-drafts',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-drafts-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const doc = await EmailDraft.create({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      subject: body.subject ?? '',
      body: body.body ?? '',
      html: body.html ?? '',
      selectedFamilyIds: body.selectedFamilyIds ?? [],
    })

    return {
      status: 201,
      data: {
        _id: String(doc._id),
        subject: doc.subject,
        body: doc.body,
        html: doc.html,
        selectedFamilyIds: (doc.selectedFamilyIds ?? []).map(String),
      },
    }
  },
})
