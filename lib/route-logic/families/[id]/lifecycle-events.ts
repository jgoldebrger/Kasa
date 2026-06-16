import { Family, LifecycleEventPayment, LifecycleEvent, Organization } from '@/lib/models'
import { lifecycle as lifecycleSchemas } from '@/lib/schemas'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'
import { getYearInTimeZone } from '@/lib/date-utils'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import {
  familyLedgerListQuery,
  listFamilyLedger,
} from '@/lib/family-ledger-list'

const LEDGER_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  query: familyLedgerListQuery,
  name: 'GET /api/families/[id]/lifecycle-events',
  fn: async ({ params, ctx, request, query }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-lifecycle-events',
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

    const baseFilter = { familyId: id, organizationId: ctx!.organizationId }
    const loadPage = (filter: Record<string, unknown>, limit: number) =>
      LifecycleEventPayment.find(filter)
        .sort({ eventDate: -1, _id: -1 })
        .limit(limit)
        .lean()

    const effectiveQuery = {
      limit: query.limit ?? 0,
      cursor: query.cursor,
    }

    try {
      const data = await listFamilyLedger(
        baseFilter,
        loadPage,
        'eventDate',
        -1,
        (last) => ({
          v: last.eventDate ? new Date(last.eventDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
        effectiveQuery,
      )
      return { data, headers: LEDGER_CACHE_HEADERS }
    } catch (err) {
      if (err instanceof Error && err.message === 'Invalid cursor') {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      throw err
    }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: lifecycleSchemas.lifecycleEventPaymentBody,
  name: 'POST /api/families/[id]/lifecycle-events',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'lifecycle-event-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    const { eventType, amount, eventDate: eventDateObj, year: parsedYear, notes } = body

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const normalizedEventType = eventType.trim().toLowerCase()
    let eventAmount = amount
    if (eventAmount === undefined) {
      const eventTypeRecord = await LifecycleEvent.findOne({
        type: normalizedEventType,
        organizationId: ctx!.organizationId,
      })
      if (eventTypeRecord) {
        eventAmount = eventTypeRecord.amount
      } else {
        return {
          status: 400,
          data: {
            error: `Event type '${eventType}' not found in database. Please create it first or provide an amount.`,
          },
        }
      }
    }

    const parsedAmount = eventAmount
    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    const eventYear = getYearInTimeZone(org?.timezone, eventDateObj)
    if (parsedYear !== eventYear) {
      return {
        status: 400,
        data: { error: `Year ${parsedYear} does not match event date year ${eventYear} in org timezone` },
      }
    }

    const event = await LifecycleEventPayment.create({
      familyId: id,
      eventType: normalizedEventType,
      amount: parsedAmount,
      eventDate: eventDateObj,
      year: parsedYear,
      notes: notes || undefined,
      organizationId: ctx!.organizationId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'lifecycleEventPayment.create',
      resourceType: 'LifecycleEventPayment',
      resourceId: event._id,
      metadata: {
        familyId: id,
        eventType: event.eventType,
        amount: parsedAmount,
        year: parsedYear,
      },
      request,
    })

    scheduleYearlyCalculationRefresh(parsedYear, ctx!.organizationId)

    return { status: 201, data: event }
  },
})
