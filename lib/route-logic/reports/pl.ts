import { handler } from '@/lib/api/handler'
import { Payment, LifecycleEventPayment, Organization } from '@/lib/models'
import { yearParam } from '@/lib/schemas'
import { buildPaymentYearFilter } from '@/lib/calculations'
import { netPaymentAmount } from '@/lib/money'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { validateDateRange } from '@/lib/validate-date-range'
import { checkRateLimit } from '@/lib/rate-limit'
import { collectCompoundCursorPages } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

// GET - Get P&L report data
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/reports/pl',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-pl',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const year = searchParams.get('year')

    // Build the org-scoped filters once
    const eventFilter: any = { organizationId: ctx!.organizationId }
    let paymentFilter: Record<string, unknown> = { organizationId: ctx!.organizationId }
    if (year) {
      const parsed = yearParam.safeParse(year)
      if (!parsed.success) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
      const yearNum = parsed.data
      if (startDate || endDate) {
        return {
          status: 400,
          data: { error: 'Provide either year or startDate/endDate, not both' },
        }
      }
      const org = await Organization.findById(ctx!.organizationId)
        .select('timezone')
        .lean<{ timezone?: string }>()
      paymentFilter = buildPaymentYearFilter(yearNum, ctx!.organizationId, org?.timezone)
      eventFilter.year = yearNum
    } else if (startDate || endDate) {
      if (!startDate || !endDate) {
        return {
          status: 400,
          data: { error: 'Both startDate and endDate are required for a date range' },
        }
      }
      const start = new Date(startDate)
      const end = new Date(endDate)
      const rangeErr = validateDateRange(start, end)
      if (rangeErr) {
        return { status: 400, data: { error: rangeErr } }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        end.setUTCHours(23, 59, 59, 999)
      }
      paymentFilter.paymentDate = { $gte: start, $lte: end }
      eventFilter.eventDate = { $gte: start, $lte: end }
    } else {
      return {
        status: 400,
        data: { error: 'Provide year or both startDate and endDate' },
      }
    }

    const [payments, events] = await Promise.all([
      collectCompoundCursorPages(
        (filter, limit) =>
          Payment.find(filter)
            .select(PAYMENT_PUBLIC_SELECT)
            .populate({
              path: 'familyId',
              select: 'name organizationId',
              match: { organizationId: ctx!.organizationId },
            })
            .sort({ paymentDate: 1, _id: 1 })
            .limit(limit)
            .lean<any[]>(),
        paymentFilter,
        'paymentDate',
        1,
        (last) => ({
          v: last.paymentDate ? new Date(last.paymentDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
      ),
      collectCompoundCursorPages(
        (filter, limit) =>
          LifecycleEventPayment.find(filter)
            .populate({
              path: 'familyId',
              select: 'name organizationId',
              match: { organizationId: ctx!.organizationId },
            })
            .sort({ eventDate: 1, _id: 1 })
            .limit(limit)
            .lean<any[]>(),
        eventFilter,
        'eventDate',
        1,
        (last) => ({
          v: last.eventDate ? new Date(last.eventDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
      ),
    ])

    // Calculate totals
    const totalIncome = payments.reduce((sum, p) => sum + netPaymentAmount(p), 0)
    const totalExpenses = events.reduce((sum, e) => sum + e.amount, 0)
    const netProfit = totalIncome - totalExpenses

    // Format payments for CSV
    const paymentRows = payments.map((payment: any) => ({
      type: 'Income',
      date: payment.paymentDate,
      year: payment.year,
      family: payment.familyId?.name || 'Unknown Family',
      description: `Payment - ${payment.type || 'membership'}`,
      amount: netPaymentAmount(payment),
      notes: payment.notes || '',
    }))

    // Format events for CSV
    const eventRows = events.map((event: any) => ({
      type: 'Expense',
      date: event.eventDate,
      year: event.year,
      family: event.familyId?.name || 'Unknown Family',
      description: `${event.eventType} - ${event.notes || ''}`,
      amount: -event.amount, // Negative for expenses
      notes: event.notes || '',
    }))

    // Combine and sort by date
    const allTransactions = [...paymentRows, ...eventRows].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )

    return {
      data: {
        transactions: allTransactions,
        summary: {
          totalIncome,
          totalExpenses,
          netProfit,
          transactionCount: allTransactions.length,
          paymentCount: payments.length,
          eventCount: events.length,
        },
        payments: paymentRows,
        events: eventRows,
      },
    }
  },
})
