import { handler } from '@/lib/api/handler'
import { Task, Payment, LifecycleEventPayment, Organization, Family } from '@/lib/models'
import {
  calendarDayBoundsInTimeZone,
  getYearInTimeZone,
  getMonthInTimeZone,
  getDayInTimeZone,
  zonedWallClockToUtc,
} from '@/lib/date-utils'
import { formatLifecycleEventPayments } from '@/lib/route-logic/events'
import { getEmailDashboardSummary } from '@/lib/route-logic/emails/dashboard-summary'
import { PAYMENT_PUBLIC_SELECT, serializePaymentsPublic } from '@/lib/payments/select'
import { loadByIdsInChunks } from '@/lib/org-pagination'

export const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const

export const UPCOMING_EVENTS_DAYS = 60

export interface DashboardAttentionTaskItem {
  _id: string
  title: string
  dueDate: Date | string
  status: string
  priority: string
}

export interface DashboardAttentionEventItem {
  _id: string
  familyId?: string
  familyName: string
  eventType: string
  eventTypeLabel: string
  eventDate: Date | string
  year?: number
  amount: number
  notes: string
}

export interface DashboardAttentionPaymentItem {
  _id: string
  familyName: string
  amount: number
  paymentDate: Date | string
}

export interface DashboardAttentionSection<T> {
  count: number
  items: T[]
}

export interface DashboardAttentionPayload {
  overdueTasks: DashboardAttentionSection<DashboardAttentionTaskItem>
  dueTodayTasks: DashboardAttentionSection<DashboardAttentionTaskItem>
  upcomingEvents: DashboardAttentionSection<DashboardAttentionEventItem>
  recentPayments: DashboardAttentionPaymentItem[]
  /** Populated by GET /api/dashboard-actions; optional for SSR defaults. */
  emailSummary?: {
    failedLast7Days: number
    lastSentAt: Date | string | null
    pendingScheduled: number
  }
}

/** Half-open UTC range for lifecycle events in the next N calendar days (org tz). */
export function upcomingEventsDateRange(
  tz: string | undefined | null,
  days = UPCOMING_EVENTS_DAYS,
  ref: Date = new Date(),
): { from: Date; toExclusive: Date } {
  const { from } = calendarDayBoundsInTimeZone(tz, ref)
  const y = getYearInTimeZone(tz, ref)
  const m = getMonthInTimeZone(tz, ref)
  const d = getDayInTimeZone(tz, ref)
  const endDay = new Date(Date.UTC(y, m - 1, d + days + 1))
  const toExclusive = zonedWallClockToUtc(
    endDay.getUTCFullYear(),
    endDay.getUTCMonth() + 1,
    endDay.getUTCDate(),
    0,
    0,
    0,
    0,
    tz,
  )
  return { from, toExclusive }
}

export function mapTaskAttentionItem(task: {
  _id: unknown
  title: string
  dueDate: Date | string
  status: string
  priority: string
}): DashboardAttentionTaskItem {
  return {
    _id: String(task._id),
    title: task.title,
    dueDate: task.dueDate,
    status: task.status,
    priority: task.priority,
  }
}

export function buildAttentionSection<T>(
  count: number,
  items: T[],
  limit: number,
): DashboardAttentionSection<T> {
  return { count, items: items.slice(0, limit) }
}

/** Shared loader for GET /api/dashboard-actions and dashboard SSR prefetch. */
export async function loadDashboardAttention(
  organizationId: string,
): Promise<DashboardAttentionPayload> {
  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string }>()

  const tz = org?.timezone
  const { from, toExclusive: todayEnd } = calendarDayBoundsInTimeZone(tz)
  const openStatus = { $in: [...OPEN_TASK_STATUSES] }

  const overdueFilter = {
    organizationId,
    dueDate: { $lt: from },
    status: openStatus,
  }
  const dueTodayFilter = {
    organizationId,
    dueDate: { $gte: from, $lt: todayEnd },
    status: openStatus,
  }
  const { from: eventFrom, toExclusive: eventTo } = upcomingEventsDateRange(tz)
  const upcomingEventsFilter = {
    organizationId,
    eventDate: { $gte: eventFrom, $lt: eventTo },
  }

  const [
    overdueCount,
    overdueRows,
    dueTodayCount,
    dueTodayRows,
    upcomingCount,
    upcomingRows,
    recentPaymentRows,
    emailSummary,
  ] = await Promise.all([
    Task.countDocuments(overdueFilter),
    Task.find(overdueFilter)
      .select('title dueDate status priority')
      .sort({ dueDate: 1, priority: -1, _id: 1 })
      .limit(3)
      .lean<any[]>(),
    Task.countDocuments(dueTodayFilter),
    Task.find(dueTodayFilter)
      .select('title dueDate status priority')
      .sort({ priority: -1, _id: 1 })
      .limit(3)
      .lean<any[]>(),
    LifecycleEventPayment.countDocuments(upcomingEventsFilter),
    LifecycleEventPayment.find(upcomingEventsFilter)
      .sort({ eventDate: 1, _id: 1 })
      .limit(5)
      .lean<any[]>(),
    Payment.find({ organizationId })
      .select(PAYMENT_PUBLIC_SELECT)
      .sort({ paymentDate: -1, _id: -1 })
      .limit(5)
      .lean<any[]>(),
    getEmailDashboardSummary(organizationId),
  ])

  const formattedEvents = await formatLifecycleEventPayments(organizationId, upcomingRows)

  const familyIds = [
    ...new Set(
      recentPaymentRows.map((p) => (p.familyId ? String(p.familyId) : '')).filter(Boolean),
    ),
  ]
  const families = await loadByIdsInChunks<any>(
    (chunk) =>
      Family.find({ _id: { $in: chunk }, organizationId })
        .select('_id name')
        .lean<any[]>(),
    familyIds,
  )
  const familyNameById = new Map<string, string>(families.map((f) => [String(f._id), f.name]))

  const recentPayments: DashboardAttentionPaymentItem[] = serializePaymentsPublic(
    recentPaymentRows,
  ).map((p) => ({
    _id: String(p._id),
    familyName: familyNameById.get(String(p.familyId)) || 'Unknown Family',
    amount: p.amount,
    paymentDate: p.paymentDate,
  }))

  return {
    overdueTasks: buildAttentionSection(overdueCount, overdueRows.map(mapTaskAttentionItem), 3),
    dueTodayTasks: buildAttentionSection(dueTodayCount, dueTodayRows.map(mapTaskAttentionItem), 3),
    upcomingEvents: buildAttentionSection(upcomingCount, formattedEvents, 5),
    recentPayments,
    emailSummary,
  }
}

// Rate limit exempt: org-scoped read — see lib/rate-limit.ts (ORG_SCOPED_READ_EXEMPT_SCOPES).
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/dashboard-actions',
  fn: async ({ ctx }) => {
    const data = await loadDashboardAttention(ctx!.organizationId)
    return {
      data,
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})
