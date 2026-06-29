/**
 * Read-only audit log viewer endpoint.
 *
 * GET /api/audit-log?cursor=&limit=&action=&userId=&resourceType=&fromDate=&toDate=&format=
 */

import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { AuditLog, OrgMembership, Organization } from '@/lib/models'
import { validateDateRange } from '@/lib/validate-date-range'
import { checkRateLimit } from '@/lib/rate-limit'
import { auditLogRetentionCutoff } from '@/lib/audit-log-retention'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

interface CursorPayload {
  ts: number
  id: string
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function csvField(value: string): string {
  const s = String(value ?? '')
  return `"${s.replace(/"/g, '""')}"`
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
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/audit-log',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'audit-log',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = request.nextUrl
    const limitRaw = Number(url.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT),
    )

    const action = (url.searchParams.get('action') || '').trim()
    const userId = (url.searchParams.get('userId') || '').trim()
    const resourceType = (url.searchParams.get('resourceType') || '').trim()
    const fromDateRaw = (url.searchParams.get('fromDate') || '').trim()
    const toDateRaw = (url.searchParams.get('toDate') || '').trim()
    const cursorRaw = (url.searchParams.get('cursor') || '').trim()
    const format = (url.searchParams.get('format') || '').trim().toLowerCase()

    const query: Record<string, any> = {
      organizationId: new Types.ObjectId(String(ctx!.organizationId)),
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('auditLogRetentionDays')
      .lean<{ auditLogRetentionDays?: number | null }>()
    const retentionCutoff = auditLogRetentionCutoff(org)
    query.createdAt = { $gte: retentionCutoff }
    if (action) {
      if (action.length > 120 || !/^[a-z0-9_.-]+$/i.test(action)) {
        return { status: 400, data: { error: 'Invalid action filter' } }
      }
      query.action = action
    }
    if (userId) {
      if (!Types.ObjectId.isValid(userId)) {
        return { status: 400, data: { error: 'Invalid userId' } }
      }
      const membership = await OrgMembership.findOne({
        organizationId: query.organizationId,
        userId: new Types.ObjectId(userId),
      }).select('_id')
      if (!membership) {
        return { status: 400, data: { error: 'User is not a member of this organization' } }
      }
      query.userId = new Types.ObjectId(userId)
    }
    if (resourceType) {
      if (resourceType.length > 64 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(resourceType)) {
        return { status: 400, data: { error: 'Invalid resourceType' } }
      }
      query.resourceType = resourceType
    }

    if (fromDateRaw || toDateRaw) {
      if (!fromDateRaw || !toDateRaw) {
        return {
          status: 400,
          data: { error: 'Both fromDate and toDate are required for a date range' },
        }
      }
      const createdAt: Record<string, Date> = { $gte: retentionCutoff }
      const from = new Date(fromDateRaw)
      const to = new Date(toDateRaw)
      const rangeErr = validateDateRange(from, to)
      if (rangeErr) {
        return { status: 400, data: { error: rangeErr } }
      }
      createdAt.$gte = from > retentionCutoff ? from : retentionCutoff
      if (/^\d{4}-\d{2}-\d{2}$/.test(toDateRaw)) {
        to.setUTCHours(23, 59, 59, 999)
      }
      createdAt.$lte = to
      query.createdAt = createdAt
    }

    if (format === 'csv') {
      const MAX_EXPORT = 10_000
      const exportRows = await AuditLog.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_EXPORT)
        .lean<any[]>()

      const header = [
        'when',
        'action',
        'userId',
        'resourceType',
        'resourceId',
        'ip',
        'userAgent',
        'metadata',
      ]
      const lines = [header.join(',')]
      for (const r of exportRows) {
        lines.push(
          [
            r.createdAt ? new Date(r.createdAt).toISOString() : '',
            csvField(r.action || ''),
            r.userId ? String(r.userId) : '',
            csvField(r.resourceType || ''),
            r.resourceId ? String(r.resourceId) : '',
            csvField(r.ip || ''),
            csvField(r.userAgent || ''),
            csvField(r.metadata ? JSON.stringify(r.metadata) : ''),
          ].join(','),
        )
      }
      const csv = lines.join('\n')
      const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
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
      .lean<any[]>()

    const hasMore = rows.length > limit
    const trimmed = hasMore ? rows.slice(0, limit) : rows
    const items = trimmed.map((r) => ({
      _id: String(r._id),
      action: String(r.action || ''),
      resourceType: String(r.resourceType || ''),
      resourceId: r.resourceId ? String(r.resourceId) : null,
      userId: r.userId ? String(r.userId) : null,
      metadata: r.metadata || null,
      ip: r.ip || null,
      userAgent: r.userAgent || null,
      createdAt: r.createdAt,
    }))

    let nextCursor: string | null = null
    if (hasMore) {
      const last = trimmed[trimmed.length - 1]
      nextCursor = encodeCursor({
        ts: new Date(last.createdAt).getTime(),
        id: String(last._id),
      })
    }

    return { data: { items, nextCursor } }
  },
})
