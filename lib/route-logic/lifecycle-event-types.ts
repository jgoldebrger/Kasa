import { handler } from '@/lib/api/handler'
import { LifecycleEvent } from '@/lib/models'
import { audit } from '@/lib/audit'
import { lifecycle as lifecycleSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' }

// GET - Get all lifecycle event types (admin-only — includes default amounts).
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/lifecycle-event-types',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'lifecycle-event-types-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const eventTypes = await loadAllByIdCursor(
      (filter, limit) =>
        LifecycleEvent.find(filter).sort({ name: 1, _id: 1 }).limit(limit).lean(),
      { organizationId: ctx!.organizationId },
    )
    return { data: eventTypes, headers: CACHE_HEADERS }
  },
})

// POST - Create a new lifecycle event type
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: lifecycleSchemas.lifecycleEventTypeBody,
  name: 'POST /api/lifecycle-event-types',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'lifecycle-event-type-create',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { type: normalizedType, name, amount: parsedAmount } = body

    // Check if type already exists
    const existing = await LifecycleEvent.findOne({
      type: normalizedType,
      organizationId: ctx!.organizationId,
    })
    if (existing) {
      return { status: 400, data: { error: 'Event type already exists' } }
    }

    const eventType = await LifecycleEvent.create({
      type: normalizedType,
      name,
      amount: parsedAmount,
      organizationId: ctx!.organizationId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'lifecycle_event_type.create',
      resourceType: 'LifecycleEvent',
      resourceId: eventType._id,
      metadata: { type: normalizedType, name, amount: parsedAmount },
      request,
    })

    return { status: 201, data: eventType }
  },
})
