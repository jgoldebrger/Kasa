import { handler } from '@/lib/api/handler'
import { Payment } from '@/lib/models'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { yearParam } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { collectCompoundCursorPages } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['memberId'],
  name: 'GET /api/members/[memberId]/payments',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-payments',
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
    const year = searchParams.get('year')

    const query: any = { memberId: params.memberId, organizationId: ctx!.organizationId }
    if (year) {
      const parsed = yearParam.safeParse(year)
      if (!parsed.success) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
      query.year = parsed.data
    }

    const payments = await collectCompoundCursorPages(
      (filter, limit) =>
        Payment.find(filter)
          .select(PAYMENT_PUBLIC_SELECT)
          .sort({ paymentDate: -1, _id: -1 })
          .limit(limit).lean(),
      query,
      'paymentDate',
      -1,
      (last) => ({
        v: last.paymentDate ? new Date(last.paymentDate as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    return { data: payments }
  },
})
