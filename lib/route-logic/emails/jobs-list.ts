/**
 * GET /api/emails/jobs — paginated EmailJob list for the org.
 */

import { Types } from 'mongoose'
import { EmailJob } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const JOB_KINDS = ['communications', 'statements', 'tax-receipts'] as const

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
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/emails/jobs',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-jobs-list',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = new URL(request.url)
    const kindParam = (url.searchParams.get('kind') || '').trim()
    const cursorRaw = (url.searchParams.get('cursor') || '').trim()
    const limitRaw = Number(url.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT),
    )

    const query: Record<string, unknown> = {
      organizationId: new Types.ObjectId(ctx!.organizationId),
      kind: { $in: JOB_KINDS },
    }

    if (kindParam) {
      if (!JOB_KINDS.includes(kindParam as (typeof JOB_KINDS)[number])) {
        return { status: 400, data: { error: 'Invalid kind' } }
      }
      query.kind = kindParam
    }

    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw)
      if (!cursor) return { status: 400, data: { error: 'Invalid cursor' } }
      query._id = { $lt: new Types.ObjectId(cursor.id) }
    }

    const rows = await EmailJob.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select(
        'kind status totalFamilies processed sent failed lastError startedAt completedAt createdAt payload year fromDate toDate',
      )
      .lean<any[]>()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const items = page.map((row) => {
      const payload = row.payload as { campaignId?: string; subject?: string } | undefined
      return {
        id: String(row._id),
        kind: row.kind,
        status: row.status,
        totalFamilies: row.totalFamilies ?? 0,
        processed: row.processed ?? 0,
        sent: row.sent ?? 0,
        failed: row.failed ?? 0,
        lastError: row.lastError || null,
        startedAt: row.startedAt ?? null,
        completedAt: row.completedAt ?? null,
        createdAt: row.createdAt,
        campaignId: payload?.campaignId ?? null,
        subject: payload?.subject ?? null,
        year: row.year ?? null,
        fromDate: row.fromDate ?? null,
        toDate: row.toDate ?? null,
      }
    })

    const nextCursor =
      hasMore && page.length > 0 ? encodeCursor(String(page[page.length - 1]._id)) : null

    return { data: { items, nextCursor } }
  },
})
