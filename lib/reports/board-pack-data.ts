import { Organization, LifecycleEventPayment } from '@/lib/models'
import { buildPlReportForYear } from '@/lib/reports/pl-data'
import { loadDelinquencySummary } from '@/lib/route-logic/collections'
import { formatLifecycleEventPayments } from '@/lib/route-logic/events'
import { upcomingEventsDateRange } from '@/lib/route-logic/dashboard-actions'

export interface BoardPackData {
  orgName: string
  year: number
  locale: string
  currency: string
  pl: {
    totalIncome: number
    totalExpenses: number
    netProfit: number
    transactionCount: number
  }
  delinquentFamilies: Array<{
    familyName: string
    amountOwed: number
    daysOverdue: number | null
  }>
  upcomingEvents: Array<{
    familyName: string
    eventTypeLabel: string
    eventDate: Date | string
    amount: number
  }>
}

const DELINQUENT_LIMIT = 10
const EVENTS_LIMIT = 10

export async function loadBoardPackData(
  organizationId: string,
  year: number,
): Promise<BoardPackData> {
  const org = await Organization.findById(organizationId)
    .select('name locale currency timezone')
    .lean<{ name?: string; locale?: string; currency?: string; timezone?: string }>()

  const [plReport, delinquency, upcomingRows] = await Promise.all([
    buildPlReportForYear(organizationId, year),
    loadDelinquencySummary(organizationId, { previewLimit: DELINQUENT_LIMIT }),
    LifecycleEventPayment.find({
      organizationId,
      ...(() => {
        const { from, toExclusive } = upcomingEventsDateRange(org?.timezone)
        return { eventDate: { $gte: from, $lt: toExclusive } }
      })(),
    })
      .sort({ eventDate: 1, _id: 1 })
      .limit(EVENTS_LIMIT)
      .lean<any[]>(),
  ])

  const formattedEvents = await formatLifecycleEventPayments(organizationId, upcomingRows)

  return {
    orgName: org?.name || 'Organization',
    year,
    locale: org?.locale || 'en-US',
    currency: org?.currency || 'USD',
    pl: {
      totalIncome: plReport.summary.totalIncome,
      totalExpenses: plReport.summary.totalExpenses,
      netProfit: plReport.summary.netProfit,
      transactionCount: plReport.summary.transactionCount,
    },
    delinquentFamilies: delinquency.items.map((d) => ({
      familyName: d.familyName,
      amountOwed: d.amountOwed,
      daysOverdue: d.daysOverdue,
    })),
    upcomingEvents: formattedEvents.map((e) => ({
      familyName: e.familyName,
      eventTypeLabel: e.eventTypeLabel,
      eventDate: e.eventDate,
      amount: e.amount,
    })),
  }
}
