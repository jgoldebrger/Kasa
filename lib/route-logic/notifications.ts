/**
 * GET  /api/notifications        — list notifications visible to current user
 * POST /api/notifications/read   — mark notifications as read
 *
 * The visibility rule:
 *   - per-user notifications (userId === current user) are visible
 *   - org-wide notifications (userId === null) are visible to every
 *     member of the org
 *
 * Reads are tracked differently for the two cases:
 *   - per-user: set `readAt` on the row
 *   - org-wide: append the user's _id to `readByUserIds` so the same
 *     row can be "read" for one admin and "unread" for another
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { ADMIN_ONLY_NOTIFICATION_KINDS } from '@/lib/notify'
import { Notification } from '@/lib/models'
import { paginationLimit, objectId, UNBOUNDED_LIST_CAP } from '@/lib/schemas/common'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  limit: paginationLimit,
  unreadOnly: z.coerce.boolean().optional(),
})

function visibilityFilter(orgId: string, userId: string) {
  return {
    organizationId: new Types.ObjectId(orgId),
    $or: [{ userId: new Types.ObjectId(userId) }, { userId: null }],
  }
}

function isReadForUser(row: any, userId: string): boolean {
  if (row.userId) return !!row.readAt
  // Org-wide notification — per-user read flag.
  const list = (row.readByUserIds || []) as Array<{ toString(): string } | string>
  return list.some((id) => id?.toString() === userId)
}

async function countUnreadNotifications(
  orgId: string,
  userId: string,
  isAdmin: boolean,
): Promise<number> {
  const orgObjId = new Types.ObjectId(orgId)
  const userObjId = new Types.ObjectId(userId)

  const perUserUnread = {
    organizationId: orgObjId,
    userId: userObjId,
    readAt: null,
  }

  const orgWideUnread: Record<string, unknown> = {
    organizationId: orgObjId,
    userId: null,
    readByUserIds: { $ne: userObjId },
  }
  if (!isAdmin) {
    orgWideUnread.kind = { $nin: Array.from(ADMIN_ONLY_NOTIFICATION_KINDS) }
  }

  return Notification.countDocuments({ $or: [perUserUnread, orgWideUnread] })
}

export const GET = handler({
  auth: 'org',
  query: querySchema,
  name: 'GET /api/notifications',
  fn: async ({ ctx, session, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'notifications-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const userId = session!.user.id
    const isAdmin = hasMinRole(ctx!.role, 'admin')
    const filter: any = visibilityFilter(ctx!.organizationId, userId)
    if (!isAdmin) {
      filter.kind = { $nin: Array.from(ADMIN_ONLY_NOTIFICATION_KINDS) }
    }
    const rows = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(query?.limit || 50, UNBOUNDED_LIST_CAP))
      .lean<any[]>()

    const items = rows.map((r) => ({
        _id: r._id.toString(),
        kind: r.kind,
        title: r.title,
        body: r.body || '',
        link: r.link || '',
        orgWide: !r.userId,
        read: isReadForUser(r, userId),
        createdAt: r.createdAt,
        metadata: r.metadata || {},
      }))

    const unreadCount = await countUnreadNotifications(
      ctx!.organizationId,
      userId,
      isAdmin,
    )
    return { data: { items, unreadCount } }
  },
})

const markBody = z.object({
  ids: z.array(objectId).max(200).optional(),
  all: z.boolean().optional(),
})

export const POST = handler({
  auth: 'org',
  body: markBody,
  name: 'POST /api/notifications',
  fn: async ({ ctx, session, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'notifications-mark-read',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const userId = session!.user.id
    const userObjId = new Types.ObjectId(userId)
    const baseFilter: any = visibilityFilter(ctx!.organizationId, userId)

    if (!body.all && !body.ids?.length) {
      return { status: 400, data: { error: 'Provide ids[] or all: true' } }
    }

    if (body.ids?.length) {
      baseFilter._id = { $in: body.ids.map((id) => new Types.ObjectId(id)) }
    }

    const isAdmin = hasMinRole(ctx!.role, 'admin')

    // Per-user notifications: stamp readAt only if not already set.
    await Notification.updateMany(
      { ...baseFilter, userId: userObjId, readAt: null },
      { $set: { readAt: new Date() } },
    )
    // Org-wide notifications: add this user to readByUserIds.
    const orgWideFilter: Record<string, unknown> = {
      ...baseFilter,
      userId: null,
      readByUserIds: { $ne: userObjId },
    }
    if (!isAdmin) {
      orgWideFilter.kind = { $nin: Array.from(ADMIN_ONLY_NOTIFICATION_KINDS) }
    }
    await Notification.updateMany(orgWideFilter, {
      $addToSet: { readByUserIds: userObjId },
    })

    return { data: { ok: true } }
  },
})
