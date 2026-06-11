import { handler } from '@/lib/api/handler'
import { calculateMemberBalance } from '@/lib/calculations'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['memberId'],
  name: 'GET /api/members/[memberId]/balance',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-balance',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { FamilyMember } = await import('@/lib/models')
    const member = await FamilyMember.findOne({
      _id: params.memberId,
      organizationId: ctx!.organizationId,
    })
    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }

    const { searchParams } = new URL(request.url)
    const asOfDateParam = searchParams.get('asOfDate')
    let asOfDate = new Date()
    if (asOfDateParam) {
      asOfDate = new Date(asOfDateParam)
      if (Number.isNaN(asOfDate.getTime())) {
        return { status: 400, data: { error: 'Invalid asOfDate' } }
      }
      const y = asOfDate.getFullYear()
      if (y < 1900 || y > 2200) {
        return { status: 400, data: { error: 'asOfDate out of supported range' } }
      }
    }

    const balance = await calculateMemberBalance(
      params.memberId as string,
      ctx!.organizationId,
      asOfDate,
    )

    return { data: balance }
  },
})
