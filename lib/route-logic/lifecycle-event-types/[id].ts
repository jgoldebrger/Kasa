import { handler } from '@/lib/api/handler'
import { LifecycleEvent } from '@/lib/models'
import { audit } from '@/lib/audit'
import { softDeleteOne } from '@/lib/recycle-bin'
import { lifecycle as lifecycleSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'

// GET - Get a specific lifecycle event type (admin-only — includes default amount).
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/lifecycle-event-types/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'lifecycle-event-type-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const eventType = await LifecycleEvent.findOne({
      _id: params.id,
      organizationId: ctx!.organizationId,
    })

    if (!eventType) {
      return { status: 404, data: { error: 'Lifecycle event type not found' } }
    }

    return { data: eventType }
  },
})

// PUT - Update a lifecycle event type
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: lifecycleSchemas.lifecycleEventTypeUpdateBody,
  name: 'PUT /api/lifecycle-event-types/[id]',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'lifecycle-event-type-update',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { name, amount: parsedAmount } = body

    const update: Record<string, unknown> = {}
    if (name !== undefined) update.name = name
    if (parsedAmount !== undefined) update.amount = parsedAmount

    const eventType = await LifecycleEvent.findOneAndUpdate(
      { _id: params.id, organizationId: ctx!.organizationId },
      update,
      { new: true },
    )

    if (!eventType) {
      return { status: 404, data: { error: 'Lifecycle event type not found' } }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'lifecycle_event_type.update',
      resourceType: 'LifecycleEvent',
      resourceId: eventType._id,
      metadata: { fields: Object.keys(update), ...update },
      request,
    })

    return { data: eventType }
  },
})

// DELETE - Move a lifecycle event type to the recycle bin (restorable for 30 days).
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/lifecycle-event-types/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'lifecycle-event-type-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const existing: any = await LifecycleEvent.findOne({
      _id: params.id,
      organizationId: ctx!.organizationId,
    })
    if (!existing) {
      return { status: 404, data: { error: 'Lifecycle event type not found' } }
    }

    const doc = await softDeleteOne('lifecycleEvent', params.id as string, ctx!, {
      metadata: { type: existing.type, name: existing.name, amount: existing.amount },
      request,
    })

    if (!doc) {
      return { status: 404, data: { error: 'Lifecycle event type not found' } }
    }

    return { data: { message: 'Lifecycle event type moved to recycle bin' } }
  },
})
