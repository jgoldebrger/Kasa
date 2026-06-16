import { handler } from '@/lib/api/handler'
import { LifecycleEvent, LifecycleEventPayment, Family } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { paginationLimit, UNBOUNDED_LIST_CAP } from '@/lib/schemas'
import {
  compoundCursorFilter,
  decodeCompoundCursor,
  encodeCompoundCursor,
  collectCompoundCursorPages,
} from '@/lib/pagination'
import { loadAllByIdCursor, loadByIdsInChunks } from '@/lib/org-pagination'

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=15' }

const listQuery = z.object({
  limit: paginationLimit,
  cursor: z.string().min(1).max(400).optional(),
})

/** Shared formatter for GET /api/events and SSR prefetch on /events. */
export async function formatLifecycleEventPayments(
  organizationId: string,
  payments: any[],
) {
  const configuredTypes = await loadAllByIdCursor<any>(
    (filter, limit) =>
      LifecycleEvent.find(filter).select('type name').sort({ _id: 1 }).limit(limit).lean<any[]>(),
    { organizationId },
  )

  const labelByType = new Map<string, string>(
    configuredTypes.map((t) => [String(t.type || '').toLowerCase(), t.name || t.type]),
  )

  const familyIds = [
    ...new Set(
      payments
        .map((p) => (p.familyId ? String(p.familyId) : ''))
        .filter(Boolean),
    ),
  ]
  const families = await loadByIdsInChunks<any>(
    (chunk) =>
      Family.find({ _id: { $in: chunk }, organizationId }, null, {
        includeDeleted: true,
      })
        .select('_id name')
        .lean<any[]>(),
    familyIds,
  )
  const familyNameById = new Map<string, string>(
    families.map((f) => [String(f._id), f.name]),
  )

  return payments.map((p) => {
    const familyId = p.familyId ? String(p.familyId) : undefined
    const familyName =
      (familyId && familyNameById.get(familyId)) || 'Unknown Family'

    const rawType = String(p.eventType || '')
    return {
      _id: String(p._id),
      familyId,
      familyName,
      eventType: rawType,
      eventTypeLabel: labelByType.get(rawType.toLowerCase()) || rawType,
      eventDate: p.eventDate,
      year: p.year,
      amount: p.amount,
      notes: p.notes || '',
    }
  })
}

// GET - All lifecycle event payments + populated family/label info.
//
// The human-readable label for each payment's `eventType` is taken from the
// configured `LifecycleEvent.name` for the org — single source of truth. If
// the type was deleted after a payment was recorded, we fall back to the raw
// `eventType` string so historical entries still render.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: listQuery,
  name: 'GET /api/events',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'events',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const filter: Record<string, unknown> = { organizationId: ctx!.organizationId }
    if (query.cursor) {
      const c = decodeCompoundCursor(query.cursor)
      if (!c) {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      const cursorDate = c.v === null ? null : new Date(c.v as number)
      Object.assign(filter, compoundCursorFilter('eventDate', cursorDate, c.id, -1))
    }

    const clientLimit = query.limit ?? 0
    const effectiveLimit = clientLimit > 0 ? clientLimit : UNBOUNDED_LIST_CAP

    const loadPaymentPage = async (pageFilter: Record<string, unknown>, limit: number) =>
      LifecycleEventPayment.find(pageFilter)
        .sort({ eventDate: -1, _id: -1 })
        .limit(limit)
        .lean<any[]>()

    let payments: any[]
    let nextCursor: string | null = null
    if (clientLimit > 0) {
      const rows = await loadPaymentPage(filter, effectiveLimit + 1)
      payments = rows
      if (rows.length > effectiveLimit) {
        payments = rows.slice(0, effectiveLimit)
        const last = payments[payments.length - 1]
        if (last) {
          nextCursor = encodeCompoundCursor({
            v: last.eventDate ? new Date(last.eventDate).getTime() : null,
            id: String(last._id),
          })
        }
      }
    } else {
      payments = await collectCompoundCursorPages(
        loadPaymentPage,
        filter,
        'eventDate',
        -1,
        (last) => ({
          v: last.eventDate ? new Date(last.eventDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
      )
    }

    const formatted = await formatLifecycleEventPayments(ctx!.organizationId, payments)

    return {
      data: clientLimit > 0 ? { items: formatted, nextCursor } : formatted,
      headers: CACHE_HEADERS,
    }
  },
})
