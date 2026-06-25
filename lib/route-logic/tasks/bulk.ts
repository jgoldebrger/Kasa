/**
 * POST /api/tasks/bulk
 *
 * Bulk complete or soft-delete tasks. Caps at 100 ids per request so a
 * single click cannot enqueue an unbounded cascade of recycle-bin writes.
 *
 * Body shape (discriminated union):
 *   { action: 'complete', ids: ObjectId[] }
 *   { action: 'delete',   ids: ObjectId[] }
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Task } from '@/lib/models'
import { audit } from '@/lib/audit'
import { objectId } from '@/lib/schemas/common'
import { softDeleteOne } from '@/lib/recycle-bin'
import { checkRateLimit } from '@/lib/rate-limit'

const idsField = z.array(objectId).min(1, 'Select at least one task').max(100)

const body = z.union([
  z.object({ action: z.literal('complete'), ids: idsField }),
  z.object({ action: z.literal('delete'), ids: idsField }),
])

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body,
  name: 'POST /api/tasks/bulk',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'tasks-bulk',
      {
        limit: 30,
        windowMs: 60_000,
      },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = new Types.ObjectId(ctx!.organizationId)
    const idObjs = body.ids.map((id) => new Types.ObjectId(id))
    const baseFilter = { _id: { $in: idObjs }, organizationId: orgId }

    if (body.action === 'complete') {
      const now = new Date()
      const result = await Task.updateMany(
        { ...baseFilter, status: { $ne: 'completed' } },
        { $set: { status: 'completed', completedAt: now } },
      )
      await audit({
        organizationId: ctx!.organizationId,
        userId: session!.user.id,
        action: 'task.bulk_complete',
        resourceType: 'Task',
        metadata: {
          ids: body.ids,
          count: result.modifiedCount || 0,
        },
        request,
      })
      return { data: { ok: true, modified: result.modifiedCount || 0 } }
    }

    let modified = 0
    const failed: string[] = []
    for (const id of body.ids) {
      try {
        const res = await softDeleteOne('task', id, ctx!, { request })
        if (res) modified += 1
      } catch (err) {
        failed.push(id)
        // eslint-disable-next-line no-console
        console.error('[tasks.bulk] soft-delete failed for', id, err)
      }
    }
    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'task.bulk_delete',
      resourceType: 'Task',
      metadata: {
        ids: body.ids,
        count: modified,
        failed: failed.length > 0 ? failed : undefined,
      },
      request,
    })
    return { data: { ok: true, modified, failed: failed.length } }
  },
})
