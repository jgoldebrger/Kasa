/**
 * DELETE /api/trash/[kind]/[id] — hard-purge a soft-deleted item.
 *
 * Owner only. This is irreversible.
 */

import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { getTrashItem, isRecyclableKind, purgeFromBin } from '@/lib/recycle-bin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/trash/[kind]/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'trash-item-get',
      { limit: 120, windowMs: 60_000 },
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

    const item = await getTrashItem(kind, id, ctx!.organizationId)
    if (!item) {
      return { status: 404, data: { error: 'Item not found in recycle bin' } }
    }

    return { data: item }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'owner',
  idParams: ['id'],
  name: 'DELETE /api/trash/[kind]/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'trash-purge',
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

    const doc = await purgeFromBin(kind, id, ctx!, { request })
    if (!doc) {
      return { status: 404, data: { error: 'Item not found in recycle bin' } }
    }

    return { data: { message: 'Permanently deleted' } }
  },
})
