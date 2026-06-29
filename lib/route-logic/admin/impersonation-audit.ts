/**
 * GET /api/admin/impersonation-audit — platform-wide support session audit log.
 */

import { Types } from 'mongoose'
import { AuditLog, Organization, User } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

const IMPERSONATION_ACTIONS = ['platform.impersonate.start', 'platform.impersonate.end'] as const

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

interface CursorPayload {
  ts: number
  id: string
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const p = JSON.parse(json)
    if (typeof p?.ts !== 'number' || typeof p?.id !== 'string') return null
    if (!Types.ObjectId.isValid(p.id)) return null
    return p
  } catch {
    return null
  }
}

export const GET = handler({
  auth: 'admin',
  name: 'GET /api/admin/impersonation-audit',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-impersonation-audit', {
      limit: 60,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = request.nextUrl
    const limitRaw = Number(url.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT),
    )
    const cursorRaw = (url.searchParams.get('cursor') || '').trim()

    const query: Record<string, unknown> = {
      action: { $in: IMPERSONATION_ACTIONS },
    }

    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw)
      if (!cursor) {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      const cursorTs = new Date(cursor.ts)
      query.$or = [
        { createdAt: { $lt: cursorTs } },
        { createdAt: cursorTs, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ]
    }

    const rows = await AuditLog.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<any[]>()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const userIds = [
      ...new Set(page.map((r) => (r.userId ? String(r.userId) : null)).filter(Boolean)),
    ] as string[]
    const orgIds = [
      ...new Set(
        page.map((r) => (r.organizationId ? String(r.organizationId) : null)).filter(Boolean),
      ),
    ] as string[]

    const [users, orgs] = await Promise.all([
      userIds.length > 0
        ? User.find({ _id: { $in: userIds } })
            .select('name email')
            .lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>()
        : Promise.resolve([]),
      orgIds.length > 0
        ? Organization.find({ _id: { $in: orgIds } })
            .select('name slug')
            .lean<{ _id: Types.ObjectId; name?: string; slug?: string }[]>()
        : Promise.resolve([]),
    ])

    const userById = new Map(users.map((u) => [String(u._id), u]))
    const orgById = new Map(orgs.map((o) => [String(o._id), o]))

    const entries = page.map((r) => {
      const user = r.userId ? userById.get(String(r.userId)) : undefined
      const org = r.organizationId ? orgById.get(String(r.organizationId)) : undefined
      const metadata =
        r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
          ? (r.metadata as Record<string, unknown>)
          : null

      return {
        id: String(r._id),
        action: String(r.action || ''),
        createdAt: r.createdAt,
        user: user
          ? {
              id: String(user._id),
              name: user.name || '',
              email: user.email || '',
            }
          : r.userId
            ? { id: String(r.userId), name: '', email: '' }
            : null,
        organization: org
          ? {
              id: String(org._id),
              name: org.name || '',
              slug: org.slug || '',
            }
          : r.organizationId
            ? { id: String(r.organizationId), name: '', slug: '' }
            : null,
        reason: typeof metadata?.reason === 'string' ? metadata.reason : null,
        readOnly: metadata?.readOnly === true ? true : metadata?.readOnly === false ? false : null,
        metadata,
      }
    })

    let nextCursor: string | null = null
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]
      nextCursor = encodeCursor({
        ts: new Date(last.createdAt).getTime(),
        id: String(last._id),
      })
    }

    return {
      data: {
        entries,
        nextCursor,
      },
    }
  },
})
