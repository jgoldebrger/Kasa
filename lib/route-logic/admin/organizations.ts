/**
 * GET /api/admin/organizations — platform-admin list of all tenants.
 */

import { Types } from 'mongoose'
import { Organization, User, Family, AuditLog } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { loadSetupProgress } from '@/lib/organizations/setup-progress-data'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 25

function decodeCursor(raw: string): { id: string } | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const p = JSON.parse(json)
    if (typeof p?.id !== 'string' || !Types.ObjectId.isValid(p.id)) return null
    return { id: p.id }
  } catch {
    return null
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url')
}

export const GET = handler({
  auth: 'admin',
  name: 'GET /api/admin/organizations',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-organizations-list', {
      limit: 60,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = request.nextUrl
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
    const cursorRaw = (url.searchParams.get('cursor') || '').trim()
    const stuckOnly = url.searchParams.get('stuck') === 'true'
    const includeProgress = url.searchParams.get('includeProgress') === 'true'
    const limitRaw = Number(url.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT),
    )

    const query: Record<string, unknown> = {}
    if (stuckOnly) {
      query.setupCompletedAt = null
    }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { slug: { $regex: escaped, $options: 'i' } },
      ]
    }

    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw)
      if (!cursor) return { status: 400, data: { error: 'Invalid cursor' } }
      query._id = { $gt: new Types.ObjectId(cursor.id) }
    }

    const rows = await Organization.find(query)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .select(
        'name slug ownerId planTier subscriptionStatus setupCompletedAt createdAt stripeCustomerId',
      )
      .lean<any[]>()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const orgIds = page.map((r) => r._id)

    const ownerIds = [...new Set(page.map((r) => String(r.ownerId)))]
    const [owners, familyCounts, lastActivityRows] = await Promise.all([
      User.find({ _id: { $in: ownerIds } })
        .select('name email')
        .lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>(),
      Family.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { organizationId: { $in: orgIds } } },
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
      ]),
      AuditLog.aggregate<{ _id: Types.ObjectId; lastAt: Date }>([
        { $match: { organizationId: { $in: orgIds } } },
        { $group: { _id: '$organizationId', lastAt: { $max: '$createdAt' } } },
      ]),
    ])

    const ownerById = new Map(owners.map((o) => [String(o._id), o]))
    const familiesByOrg = new Map(familyCounts.map((f) => [String(f._id), f.count]))
    const lastActivityByOrg = new Map(lastActivityRows.map((r) => [String(r._id), r.lastAt]))

    const progressByOrg = includeProgress
      ? new Map(
          await Promise.all(
            orgIds.map(async (id) => {
              const progress = await loadSetupProgress(String(id))
              return [String(id), progress] as const
            }),
          ),
        )
      : null

    const organizations = page.map((org) => {
      const owner = ownerById.get(String(org.ownerId))
      const orgId = String(org._id)
      const createdAt = org.createdAt ? new Date(org.createdAt) : null
      const daysSinceCreated =
        createdAt && !Number.isNaN(createdAt.getTime())
          ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
          : null
      const lastActivity = lastActivityByOrg.get(orgId)
      const progress = progressByOrg?.get(orgId)

      return {
        id: orgId,
        name: org.name,
        slug: org.slug,
        planTier: org.planTier || null,
        subscriptionStatus: org.subscriptionStatus || null,
        setupCompletedAt: org.setupCompletedAt || null,
        createdAt: org.createdAt,
        daysSinceCreated,
        lastActivityAt: lastActivity || null,
        familyCount: familiesByOrg.get(orgId) || 0,
        owner: owner
          ? { id: String(owner._id), name: owner.name || '', email: owner.email || '' }
          : null,
        ...(progress
          ? {
              setupProgress: {
                completed: progress.completed,
                total: progress.total,
                requiredComplete: progress.requiredComplete,
                complete: progress.complete,
                steps: progress.steps.map((s) => ({
                  id: s.id,
                  done: s.done,
                  optional: s.optional ?? false,
                })),
              },
            }
          : {}),
      }
    })

    const nextCursor =
      hasMore && page.length > 0 ? encodeCursor(String(page[page.length - 1]._id)) : null

    return {
      data: {
        organizations,
        nextCursor,
        totalReturned: organizations.length,
      },
    }
  },
})
