import { handler } from '@/lib/api/handler'
import { LifecycleEvent, LifecycleEventPayment, Family } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { loadAllByIdCursor, loadByIdsInChunks } from '@/lib/org-pagination'

// GET - All lifecycle event payments + populated family/label info.
//
// The human-readable label for each payment's `eventType` is taken from the
// configured `LifecycleEvent.name` for the org — single source of truth. If
// the type was deleted after a payment was recorded, we fall back to the raw
// `eventType` string so historical entries still render.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/events',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'events',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    // Hard cap on the unbounded path — see UNBOUNDED_LIST_CAP. Older
    // orgs with many years of bar-mitzvah / wedding entries could
    // otherwise materialise tens of thousands of payments per request.
    const [payments, configuredTypes] = await Promise.all([
      collectCompoundCursorPages(
        (filter, limit) =>
          LifecycleEventPayment.find(filter)
            .sort({ eventDate: -1, _id: -1 })
            .limit(limit)
            .lean<any[]>(),
        { organizationId: ctx!.organizationId },
        'eventDate',
        -1,
        (last) => ({
          v: last.eventDate ? new Date(last.eventDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
      ),
      loadAllByIdCursor<any>(
        (filter, limit) =>
          LifecycleEvent.find(filter).select('type name').sort({ _id: 1 }).limit(limit).lean<any[]>(),
        { organizationId: ctx!.organizationId },
      ),
    ])

    const labelByType = new Map<string, string>(
      configuredTypes.map((t) => [String(t.type || '').toLowerCase(), t.name || t.type]),
    )

    // Batch-resolve family names. Populate `match` nullifies `familyId` when
    // the family is soft-deleted, losing the id entirely — includeDeleted
    // keeps historical event rows labeled correctly after a family lands
    // in the recycle bin.
    const familyIds = [
      ...new Set(
        payments
          .map((p) => (p.familyId ? String(p.familyId) : ''))
          .filter(Boolean),
      ),
    ]
    const families = await loadByIdsInChunks<any>(
      (chunk) =>
        Family.find({ _id: { $in: chunk }, organizationId: ctx!.organizationId }, null, {
          includeDeleted: true,
        })
          .select('_id name')
          .lean<any[]>(),
      familyIds,
    )
    const familyNameById = new Map<string, string>(
      families.map((f) => [String(f._id), f.name]),
    )

    const formatted = payments.map((p) => {
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

    return { data: formatted }
  },
})
