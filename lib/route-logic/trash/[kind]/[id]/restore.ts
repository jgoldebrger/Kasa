/**
 * POST /api/trash/[kind]/[id]/restore — restore a soft-deleted item.
 *
 * Restoring a family also restores its cascade-deleted children. Admin+ only.
 */

import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { isRecyclableKind, restoreFromBin } from '@/lib/recycle-bin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'POST /api/trash/[kind]/[id]/restore',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'trash-restore',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const kind = params.kind as string
    const id = params.id as string

    if (!isRecyclableKind(kind)) {
      return { status: 400, data: { error: 'Invalid kind' } }
    }
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid id' } }
    }

    let result
    try {
      result = await restoreFromBin(kind, id, ctx!, { request })
    } catch (err: any) {
      // Partial-unique indexes on PaymentPlan/LifecycleEvent reject restores
      // that would clash with an existing live row.
      if (err?.code === 11000) {
        return {
          status: 409,
          data: {
            error: 'Cannot restore: an existing item already uses the same unique identifier (e.g. plan number or event type). Rename or delete the live item first.',
          },
        }
      }
      if (err?.code === 'PARENT_FAMILY_DELETED') {
        return { status: 409, data: { error: err.message } }
      }
      throw err
    }
    if (!result) {
      return { status: 404, data: { error: 'Item not found in recycle bin' } }
    }

    return {
      data: {
        message: 'Restored',
        cascadeRestored: result.cascadeRestored,
      },
    }
  },
})
