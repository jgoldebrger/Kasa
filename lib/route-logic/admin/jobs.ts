/**
 * GET /api/admin/jobs — platform-admin list of cron JobRun rows and failed EmailJobs.
 */

import { Types } from 'mongoose'
import { JobRun, EmailJob } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const DEFAULT_DAYS = 7

const KNOWN_JOB_NAMES = [
  'process-recurring-payments',
  'generate-monthly-statements',
  'send-monthly-statements',
  'cycle-rollover',
  'wedding-converter',
] as const

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
  name: 'GET /api/admin/jobs',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-jobs-list', {
      limit: 60,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = request.nextUrl
    const name = (url.searchParams.get('name') || '').trim()
    const failedOnly = url.searchParams.get('failedOnly') === 'true'
    const cursorRaw = (url.searchParams.get('cursor') || '').trim()
    const daysRaw = Number(url.searchParams.get('days') || DEFAULT_DAYS)
    const days = Math.min(
      90,
      Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : DEFAULT_DAYS),
    )
    const limitRaw = Number(url.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT),
    )

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const query: Record<string, unknown> = { startedAt: { $gte: since } }

    if (name) {
      query.name = name
    }
    if (failedOnly) {
      query.$or = [{ status: 'failed' }, { failed: { $gt: 0 } }]
    }

    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw)
      if (!cursor) return { status: 400, data: { error: 'Invalid cursor' } }
      query._id = { $lt: new Types.ObjectId(cursor.id) }
    }

    const rows = await JobRun.find(query)
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<any[]>()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const failedEmailJobs = await EmailJob.find({
      status: 'failed',
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('organizationId kind status lastError processed failed sent createdAt completedAt')
      .lean<any[]>()

    const jobRuns = page.map((row) => ({
      id: String(row._id),
      name: row.name,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt || null,
      processed: row.processed ?? 0,
      failed: row.failed ?? 0,
      lastError: row.lastError || null,
      errorCount: Array.isArray(row.errors) ? row.errors.length : 0,
      cursorIn: row.cursorIn || null,
      cursorOut: row.cursorOut || null,
      metadata: row.metadata || null,
    }))

    const nextCursor =
      hasMore && page.length > 0 ? encodeCursor(String(page[page.length - 1]._id)) : null

    return {
      data: {
        jobRuns,
        failedEmailJobs: failedEmailJobs.map((j) => ({
          id: String(j._id),
          organizationId: String(j.organizationId),
          kind: j.kind,
          status: j.status,
          lastError: j.lastError || null,
          processed: j.processed ?? 0,
          failed: j.failed ?? 0,
          sent: j.sent ?? 0,
          createdAt: j.createdAt,
          completedAt: j.completedAt || null,
        })),
        knownJobNames: KNOWN_JOB_NAMES,
        nextCursor,
        filters: { days, name: name || null, failedOnly },
      },
    }
  },
})
