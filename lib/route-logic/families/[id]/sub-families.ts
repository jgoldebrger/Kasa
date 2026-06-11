import { Family } from '@/lib/models'
import { hasMinRole } from '@/lib/auth-helpers'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { collectCompoundCursorPages } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

// GET - Get all sub-families (families created from members of this family)
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  name: 'GET /api/families/[id]/sub-families',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-sub-families',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const subFamilies = await collectCompoundCursorPages(
      (filter, limit) =>
        Family.find(filter).sort({ weddingDate: -1, _id: -1 }).limit(limit).lean(),
      { parentFamilyId: id, organizationId: ctx!.organizationId },
      'weddingDate',
      -1,
      (last) => ({
        v: last.weddingDate ? new Date(last.weddingDate as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    const isAdmin = hasMinRole(ctx!.role, 'admin')
    const out = isAdmin
      ? subFamilies
      : subFamilies.map((f) => {
          const row = { ...f }
          delete (row as any).openBalance
          delete (row as any).currentPayment
          delete (row as any).currentPlan
          delete (row as any).paymentPlanId
          return row
        })

    return { data: out }
  },
})
