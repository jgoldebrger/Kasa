import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { Task, ScheduledEmail, LifecycleEventPayment, Organization } from '@/lib/models'
import { calendarDayBoundsFromDateKey, dateKeyInTimeZone, parseDateKey } from '@/lib/date-utils'
import { formatLifecycleEventPayments } from '@/lib/route-logic/events'

export const dynamic = 'force-dynamic'

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=15' }

const MAX_RANGE_DAYS = 93

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type CalendarItemKind = 'task' | 'lifecycle_event' | 'scheduled_email'

export type CalendarItem = {
  id: string
  kind: CalendarItemKind
  title: string
  date: string
  dateKey: string
  href: string
  subtitle?: string
  status?: string
}

function daySpan(fromKey: string, toKey: string): number | null {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  if (!from || !to) return null
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day)
  const toUtc = Date.UTC(to.year, to.month - 1, to.day)
  if (toUtc < fromUtc) return null
  return Math.round((toUtc - fromUtc) / 86_400_000) + 1
}

function taskHref(task: { _id: unknown; relatedFamilyId?: { _id?: unknown } | unknown }): string {
  const familyRef = task.relatedFamilyId
  const familyId =
    familyRef && typeof familyRef === 'object' && familyRef !== null && '_id' in familyRef
      ? String((familyRef as { _id: unknown })._id)
      : null
  if (familyId) return `/families/${familyId}`
  return '/tasks'
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: listQuery,
  name: 'GET /api/calendar',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'calendar',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const span = daySpan(query.from, query.to)
    if (span === null) {
      return { status: 400, data: { error: 'Invalid date range' } }
    }
    if (span > MAX_RANGE_DAYS) {
      return {
        status: 400,
        data: { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` },
      }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    const timezone = org?.timezone?.trim() || 'UTC'

    const fromBounds = calendarDayBoundsFromDateKey(query.from, timezone)
    const toBounds = calendarDayBoundsFromDateKey(query.to, timezone)
    if (!fromBounds || !toBounds) {
      return { status: 400, data: { error: 'Invalid from or to date' } }
    }

    const rangeFilter = { $gte: fromBounds.fromDate, $lte: toBounds.toDate }

    const [tasks, lifecyclePayments, scheduledEmails] = await Promise.all([
      Task.find({
        organizationId: ctx!.organizationId,
        status: { $nin: ['completed', 'cancelled'] },
        dueDate: rangeFilter,
      })
        .select('title dueDate status priority relatedFamilyId')
        .populate({
          path: 'relatedFamilyId',
          select: 'name organizationId',
          match: { organizationId: ctx!.organizationId },
        })
        .sort({ dueDate: 1, _id: 1 })
        .limit(500)
        .lean<any[]>(),
      LifecycleEventPayment.find({
        organizationId: ctx!.organizationId,
        eventDate: rangeFilter,
      })
        .sort({ eventDate: 1, _id: 1 })
        .limit(500)
        .lean<any[]>(),
      ScheduledEmail.find({
        organizationId: ctx!.organizationId,
        scheduledFor: rangeFilter,
        status: { $in: ['pending', 'sent', 'failed'] },
      })
        .sort({ scheduledFor: 1, _id: 1 })
        .limit(500)
        .lean<any[]>(),
    ])

    const formattedEvents = await formatLifecycleEventPayments(
      ctx!.organizationId,
      lifecyclePayments,
    )

    const items: CalendarItem[] = []

    for (const task of tasks) {
      const due = task.dueDate ? new Date(task.dueDate) : null
      if (!due || Number.isNaN(due.getTime())) continue
      const familyName =
        task.relatedFamilyId && typeof task.relatedFamilyId === 'object'
          ? (task.relatedFamilyId as { name?: string }).name
          : undefined
      items.push({
        id: String(task._id),
        kind: 'task',
        title: task.title || 'Task',
        date: due.toISOString(),
        dateKey: dateKeyInTimeZone(timezone, due),
        href: taskHref(task),
        subtitle: familyName,
        status: task.status,
      })
    }

    for (const event of formattedEvents) {
      const eventDate = event.eventDate ? new Date(event.eventDate) : null
      if (!eventDate || Number.isNaN(eventDate.getTime())) continue
      items.push({
        id: String(event._id),
        kind: 'lifecycle_event',
        title: event.eventTypeLabel || event.eventType || 'Event',
        date: eventDate.toISOString(),
        dateKey: dateKeyInTimeZone(timezone, eventDate),
        href: event.familyId ? `/families/${event.familyId}` : '/events',
        subtitle: event.familyName,
      })
    }

    for (const row of scheduledEmails) {
      const scheduledFor = row.scheduledFor ? new Date(row.scheduledFor) : null
      if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) continue
      const familyCount = Array.isArray(row.familyIds) ? row.familyIds.length : 0
      items.push({
        id: String(row._id),
        kind: 'scheduled_email',
        title: row.subject || 'Scheduled email',
        date: scheduledFor.toISOString(),
        dateKey: dateKeyInTimeZone(timezone, scheduledFor),
        href: '/communications/scheduled',
        subtitle: familyCount > 0 ? `${familyCount} families` : undefined,
        status: row.status,
      })
    }

    items.sort((a, b) => {
      const t = new Date(a.date).getTime() - new Date(b.date).getTime()
      if (t !== 0) return t
      return a.title.localeCompare(b.title)
    })

    return {
      data: {
        timezone,
        from: query.from,
        to: query.to,
        items,
      },
      headers: CACHE_HEADERS,
    }
  },
})
