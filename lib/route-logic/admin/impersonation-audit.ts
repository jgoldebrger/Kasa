/**
 * GET /api/admin/impersonation-audit — platform-wide support session audit log.
 *
 * Query: cursor, limit, action (start|end), organizationId, userId, q (org name/slug),
 * fromDate, toDate, format (csv).
 */

import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { AuditLog, Organization, User } from '@/lib/models'
import { validateDateRange } from '@/lib/validate-date-range'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

const IMPERSONATION_ACTIONS = ['platform.impersonate.start', 'platform.impersonate.end'] as const

const ACTION_BY_FILTER: Record<string, string> = {
  start: 'platform.impersonate.start',
  end: 'platform.impersonate.end',
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const MAX_EXPORT = 10_000

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

function csvField(value: string): string {
  const s = String(value ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function actionLabel(action: string): string {
  if (action === 'platform.impersonate.start') return 'start'
  if (action === 'platform.impersonate.end') return 'end'
  return action
}

function readOnlyLabel(action: string, metadata: Record<string, unknown> | null): string {
  if (action !== 'platform.impersonate.start') return ''
  const readOnly = metadata?.readOnly
  if (readOnly === true) return 'yes'
  if (readOnly === false) return 'no'
  return ''
}

async function resolveOrganizationFilter(
  organizationId: string,
  orgQ: string,
): Promise<{ organizationId?: Types.ObjectId | { $in: Types.ObjectId[] } } | { error: string }> {
  if (organizationId) {
    if (!Types.ObjectId.isValid(organizationId)) {
      return { error: 'Invalid organizationId' }
    }
    return { organizationId: new Types.ObjectId(organizationId) }
  }

  if (!orgQ) return {}

  const escaped = orgQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matchingOrgs = await Organization.find({
    $or: [
      { name: { $regex: escaped, $options: 'i' } },
      { slug: { $regex: escaped, $options: 'i' } },
    ],
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()

  if (matchingOrgs.length === 0) {
    return { organizationId: { $in: [] } }
  }

  return { organizationId: { $in: matchingOrgs.map((o) => o._id) } }
}

function mapAuditRow(
  r: Record<string, unknown>,
  userById: Map<string, { name?: string; email?: string }>,
  orgById: Map<string, { name?: string; slug?: string }>,
) {
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
          id: String(r.userId),
          name: user.name || '',
          email: user.email || '',
        }
      : r.userId
        ? { id: String(r.userId), name: '', email: '' }
        : null,
    organization: org
      ? {
          id: String(r.organizationId),
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
}

async function hydrateRows(rows: Record<string, unknown>[]) {
  const userIds = [
    ...new Set(rows.map((r) => (r.userId ? String(r.userId) : null)).filter(Boolean)),
  ] as string[]
  const orgIds = [
    ...new Set(
      rows.map((r) => (r.organizationId ? String(r.organizationId) : null)).filter(Boolean),
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

  return rows.map((r) => mapAuditRow(r, userById, orgById))
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
    const actionFilter = (url.searchParams.get('action') || '').trim().toLowerCase()
    const organizationId = (url.searchParams.get('organizationId') || '').trim()
    const userId = (url.searchParams.get('userId') || '').trim()
    const orgQ = (url.searchParams.get('q') || '').trim().slice(0, 120)
    const fromDateRaw = (url.searchParams.get('fromDate') || '').trim()
    const toDateRaw = (url.searchParams.get('toDate') || '').trim()
    const format = (url.searchParams.get('format') || '').trim().toLowerCase()

    const query: Record<string, unknown> = {}

    if (actionFilter) {
      const mapped = ACTION_BY_FILTER[actionFilter]
      if (!mapped) {
        return { status: 400, data: { error: 'Invalid action filter' } }
      }
      query.action = mapped
    } else {
      query.action = { $in: IMPERSONATION_ACTIONS }
    }

    if (userId) {
      if (!Types.ObjectId.isValid(userId)) {
        return { status: 400, data: { error: 'Invalid userId' } }
      }
      query.userId = new Types.ObjectId(userId)
    }

    const orgFilter = await resolveOrganizationFilter(organizationId, orgQ)
    if ('error' in orgFilter) {
      return { status: 400, data: { error: orgFilter.error } }
    }
    if (orgFilter.organizationId) {
      query.organizationId = orgFilter.organizationId
    }

    if (fromDateRaw || toDateRaw) {
      if (!fromDateRaw || !toDateRaw) {
        return {
          status: 400,
          data: { error: 'Both fromDate and toDate are required for a date range' },
        }
      }
      const createdAt: Record<string, Date> = {}
      const from = new Date(fromDateRaw)
      const to = new Date(toDateRaw)
      const rangeErr = validateDateRange(from, to)
      if (rangeErr) {
        return { status: 400, data: { error: rangeErr } }
      }
      createdAt.$gte = from
      if (/^\d{4}-\d{2}-\d{2}$/.test(toDateRaw)) {
        to.setUTCHours(23, 59, 59, 999)
      }
      createdAt.$lte = to
      query.createdAt = createdAt
    }

    if (format === 'csv') {
      const exportRows = await AuditLog.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_EXPORT)
        .lean<Record<string, unknown>[]>()

      const entries = await hydrateRows(exportRows)
      const header = ['time', 'admin email', 'org name', 'action', 'reason', 'readOnly']
      const lines = [header.join(',')]
      for (const entry of entries) {
        const metadata =
          entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, unknown>)
            : null
        lines.push(
          [
            entry.createdAt ? new Date(entry.createdAt as string | Date).toISOString() : '',
            csvField(entry.user?.email || ''),
            csvField(entry.organization?.name || ''),
            csvField(actionLabel(entry.action)),
            csvField(entry.reason || ''),
            csvField(readOnlyLabel(entry.action, metadata)),
          ].join(','),
        )
      }
      const csv = lines.join('\n')
      const filename = `support-audit-${new Date().toISOString().slice(0, 10)}.csv`
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
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
      .lean<Record<string, unknown>[]>()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const entries = await hydrateRows(page)

    let nextCursor: string | null = null
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]
      nextCursor = encodeCursor({
        ts: new Date(last.createdAt as string | Date).getTime(),
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
