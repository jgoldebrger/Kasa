import { Payment, LifecycleEventPayment, Organization } from '@/lib/models'
import { buildPaymentYearFilter } from '@/lib/calculations'
import { netPaymentAmount } from '@/lib/money'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { collectCompoundCursorPages } from '@/lib/pagination'

export interface PlReportTransaction {
  type: string
  date: string | Date
  year: number
  family: string
  description: string
  amount: number
  notes: string
}

export interface PlReportSummary {
  totalIncome: number
  totalExpenses: number
  netProfit: number
  transactionCount: number
  paymentCount: number
  eventCount: number
}

export interface PlReportData {
  transactions: PlReportTransaction[]
  summary: PlReportSummary
}

export async function buildPlReportForYear(
  organizationId: string,
  year: number,
): Promise<PlReportData> {
  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string }>()

  const paymentFilter = buildPaymentYearFilter(year, organizationId, org?.timezone)
  const eventFilter: Record<string, unknown> = { organizationId, year }

  const [payments, events] = await Promise.all([
    collectCompoundCursorPages(
      (filter, limit) =>
        Payment.find(filter)
          .select(PAYMENT_PUBLIC_SELECT)
          .populate({
            path: 'familyId',
            select: 'name organizationId',
            match: { organizationId },
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
            match: { organizationId },
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

  const totalIncome = payments.reduce((sum, p) => sum + netPaymentAmount(p), 0)
  const totalExpenses = events.reduce((sum, e) => sum + e.amount, 0)
  const netProfit = totalIncome - totalExpenses

  const paymentRows: PlReportTransaction[] = payments.map((payment: any) => ({
    type: 'Income',
    date: payment.paymentDate,
    year: payment.year,
    family: payment.familyId?.name || 'Unknown Family',
    description: `Payment - ${payment.type || 'membership'}`,
    amount: netPaymentAmount(payment),
    notes: payment.notes || '',
  }))

  const eventRows: PlReportTransaction[] = events.map((event: any) => ({
    type: 'Expense',
    date: event.eventDate,
    year: event.year,
    family: event.familyId?.name || 'Unknown Family',
    description: `${event.eventType} - ${event.notes || ''}`,
    amount: -event.amount,
    notes: event.notes || '',
  }))

  const allTransactions = [...paymentRows, ...eventRows].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )

  return {
    transactions: allTransactions,
    summary: {
      totalIncome,
      totalExpenses,
      netProfit,
      transactionCount: allTransactions.length,
      paymentCount: payments.length,
      eventCount: events.length,
    },
  }
}
