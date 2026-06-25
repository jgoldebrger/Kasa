import { Types } from 'mongoose'
import { EmailMessage } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/emails/[id]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid email id' } }
    }

    const row = await EmailMessage.findOne({
      _id: id,
      organizationId: ctx!.organizationId,
    }).lean<any>()

    if (!row) return { status: 404, data: { error: 'Email not found' } }

    return {
      data: {
        _id: String(row._id),
        organizationId: String(row.organizationId),
        familyId: row.familyId ? String(row.familyId) : null,
        userId: row.userId ? String(row.userId) : null,
        campaignId: row.campaignId ? String(row.campaignId) : null,
        to: row.to,
        subject: row.subject,
        bodyPreview: row.bodyPreview ?? null,
        html: row.html ?? null,
        text: row.text ?? null,
        kind: row.kind,
        status: row.status,
        error: row.error ?? null,
        openCount: row.openCount ?? 0,
        clickCount: row.clickCount ?? 0,
        firstOpenedAt: row.firstOpenedAt ?? null,
        firstClickedAt: row.firstClickedAt ?? null,
        openTracking: row.openTracking ?? false,
        clickTracking: row.clickTracking ?? false,
        events: (row.events ?? []).map((ev: any) => ({
          type: ev.type,
          at: ev.at,
          meta: ev.meta ?? null,
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    }
  },
})
