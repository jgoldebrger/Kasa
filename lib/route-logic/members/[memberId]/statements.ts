import { Statement, FamilyMember, Payment, LifecycleEventPayment, nextCounter } from '@/lib/models'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { report as reportSchemas } from '@/lib/schemas'
import { netPaymentAmount } from '@/lib/money'
import { tolerantMsRange } from '@/lib/date-utils'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['memberId'],
  name: 'GET /api/members/[memberId]/statements',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-statements-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const memberId = params.memberId as string

    const member = await FamilyMember.findOne({
      _id: memberId,
      organizationId: ctx!.organizationId,
    }).select('_id')
    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }

    const statements = await collectCompoundCursorPages(
      (filter, limit) =>
        Statement.find(filter).sort({ date: -1, _id: -1 }).limit(limit).lean(),
      { memberId, organizationId: ctx!.organizationId },
      'date',
      -1,
      (last) => ({
        v: last.date ? new Date(last.date as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    return { data: statements }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['memberId'],
  body: reportSchemas.statementDateRangeBody,
  name: 'POST /api/members/[memberId]/statements',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-statement-generate',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const memberId = params.memberId as string
    const { fromDate: from, toDate: to } = body

    const { calculateMemberBalance } = await import('@/lib/calculations')

    const member = await FamilyMember.findOne({ _id: memberId, organizationId: ctx!.organizationId })
    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }

    const openingBalanceData = await calculateMemberBalance(memberId, ctx!.organizationId, new Date(from.getTime() - 1))
    const openingBalance = openingBalanceData.balance

    const payments = await loadAllByIdCursor<any>(
      (filter, limit) =>
        Payment.find(filter)
          .select(PAYMENT_PUBLIC_SELECT)
          .sort({ _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      {
        memberId,
        paymentDate: { $gte: from, $lte: to },
        organizationId: ctx!.organizationId,
      },
    )
    const totalIncome = payments.reduce((sum, p) => sum + netPaymentAmount(p), 0)

    const lifecycleEvents = await loadAllByIdCursor<any>(
      (filter, limit) =>
        LifecycleEventPayment.find(filter).sort({ _id: 1 }).limit(limit).lean<any[]>(),
      {
        memberId,
        eventDate: { $gte: from, $lte: to },
        organizationId: ctx!.organizationId,
      },
    )
    const totalExpenses = lifecycleEvents.reduce((sum, e) => {
      const amt = Number(e.amount || 0)
      return Number.isFinite(amt) && amt >= 0 ? sum + amt : sum
    }, 0)

    const closingBalanceData = await calculateMemberBalance(memberId, ctx!.organizationId, to)
    const closingBalance = closingBalanceData.balance

    const existing = await Statement.findOne({
      organizationId: ctx!.organizationId,
      memberId,
      fromDate: tolerantMsRange(from),
      toDate: tolerantMsRange(to),
    })
    if (existing) {
      const refreshed = await Statement.findOneAndUpdate(
        { _id: existing._id, organizationId: ctx!.organizationId, memberId },
        {
          $set: {
            openingBalance,
            income: totalIncome,
            withdrawals: 0,
            expenses: totalExpenses,
            cycleCharges: 0,
            closingBalance,
          },
        },
        { new: true },
      )
      return { data: refreshed ?? existing }
    }

    const seq = await nextCounter(
      `stmt-mem:${ctx!.organizationId}:${memberId}`,
      async () =>
        Statement.countDocuments({
          memberId,
          organizationId: ctx!.organizationId,
        }),
    )
    const statementNumber = `STMT-MEM-${memberId.slice(-6)}-${seq}`

    try {
      const statement = await Statement.create({
        familyId: member.familyId,
        memberId,
        statementNumber,
        date: new Date(),
        fromDate: from,
        toDate: to,
        openingBalance,
        income: totalIncome,
        withdrawals: 0,
        expenses: totalExpenses,
        closingBalance,
        cycleCharges: 0,
        organizationId: ctx!.organizationId,
      })
      return { status: 201, data: statement }
    } catch (err: any) {
      if (err?.code === 11000) {
        const raced = await Statement.findOne({
          organizationId: ctx!.organizationId,
          memberId,
          fromDate: tolerantMsRange(from),
          toDate: tolerantMsRange(to),
        })
        if (raced) {
          const refreshed = await Statement.findOneAndUpdate(
            { _id: raced._id, organizationId: ctx!.organizationId, memberId },
            {
              $set: {
                openingBalance,
                income: totalIncome,
                withdrawals: 0,
                expenses: totalExpenses,
                cycleCharges: 0,
                closingBalance,
              },
            },
            { new: true },
          )
          return { data: refreshed ?? raced }
        }
      }
      throw err
    }
  },
})
