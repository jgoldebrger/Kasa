/**
 * Tiny chunked-job runner for HTTP-triggered cron.
 *
 * Pattern:
 *   1. Cron fires POST /api/jobs/<name> (no cursor).
 *   2. Handler grabs N orgs via runChunked, processes them, writes a
 *      JobRun row, and — if more remain — fires a self-call to the same
 *      endpoint with ?cursor=<lastId>.
 *   3. Each batch fits comfortably under the serverless 10s timeout.
 *
 * Why not a real queue (BullMQ etc)? Because the pattern works on
 * Vercel (no long-running worker), Railway (works), Fly (works), VPS
 * (works), with zero extra infra. We pay one extra HTTP round-trip per
 * batch which is rounding error compared to PDF/email work.
 */

import { Types } from 'mongoose'
import { HDate } from '@hebcal/hdate'
import connectDB from '@/lib/database'
import { Organization, Family, JobRun } from '@/lib/models'
import { logError } from '@/lib/log'
import {
  getDayInTimeZone,
  getMonthInTimeZone,
  getYearInTimeZone,
  startOfDayInTimeZone,
} from '@/lib/date-utils'

export interface ChunkResult {
  processed: number
  failed: number
  errors: { orgId: string; error: string }[]
}

export interface ChunkOptions {
  name: string
  batchSize?: number
  cursor?: string | null
  /** Where to POST the next batch. Should be a fully-qualified URL. */
  selfUrl: string
  /** Process one organization. Throw to record failure (loop continues). */
  perOrg: (organizationId: string) => Promise<void>
  /** Optional metadata stored on the JobRun row. */
  metadata?: Record<string, unknown>
  /**
   * Optional extra Mongo filter applied on top of the cursor pagination
   * (e.g. `{ monthlyStatementAutoGenerate: true }` to limit a cron to
   * opted-in orgs). Cursor pagination by `_id` still works because the
   * filters compose; the cursor advances past the LAST org we scanned
   * in this batch, not just past the ones that matched.
   */
  orgFilter?: Record<string, unknown>
}

const DEFAULT_BATCH_SIZE = 25
/** Matches statement email worker batch size — fits under serverless timeout. */
export const DEFAULT_FAMILY_BATCH_SIZE = 5
const MAX_RECORDED_ERRORS = 50

/**
 * Run one chunk of organizations and (if more remain) trigger the next
 * batch via fire-and-forget HTTP. Returns the chunk result; the caller
 * formats the HTTP response.
 */
export async function runChunked(opts: ChunkOptions): Promise<ChunkResult & { hasMore: boolean; cursorOut: string | null; jobRunId: string }> {
  await connectDB()

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const cursor = opts.cursor || null

  const jobRun = await JobRun.create({
    name: opts.name,
    status: 'running',
    startedAt: new Date(),
    cursorIn: cursor,
    metadata: opts.metadata || {},
  })

  // Fetch one extra so we can tell `hasMore` without a second query.
  const query: Record<string, unknown> = { ...(opts.orgFilter || {}) }
  if (cursor && Types.ObjectId.isValid(cursor)) {
    query._id = { $gt: new Types.ObjectId(cursor) }
  }
  const orgs = await Organization.find(query)
    .sort({ _id: 1 })
    .limit(batchSize + 1)
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()

  const hasMore = orgs.length > batchSize
  const batch = hasMore ? orgs.slice(0, batchSize) : orgs
  const cursorOut = hasMore ? batch[batch.length - 1]._id.toString() : null

  const result: ChunkResult = { processed: 0, failed: 0, errors: [] }

  for (const org of batch) {
    const orgId = org._id.toString()
    try {
      await opts.perOrg(orgId)
      result.processed += 1
    } catch (err: any) {
      result.failed += 1
      if (result.errors.length < MAX_RECORDED_ERRORS) {
        result.errors.push({ orgId, error: err?.message || String(err) })
      }
    }
  }

  await JobRun.findByIdAndUpdate(jobRun._id, {
    status: 'completed',
    completedAt: new Date(),
    cursorOut,
    processed: result.processed,
    failed: result.failed,
    errors: result.errors,
    lastError: result.errors[result.errors.length - 1]?.error,
  })

  // Fire-and-forget next batch. Don't await — we want this request to
  // return promptly so the cron trigger sees success.
  if (hasMore && cursorOut) {
    triggerNextBatch(opts.selfUrl, cursorOut, { cursorParam: 'cursor' }).catch((err) => {
      logError(err, { module: 'jobs', job: opts.name, phase: 'next-batch' })
    })
  }

  return { ...result, hasMore, cursorOut, jobRunId: jobRun._id.toString() }
}

export interface FamilyChunkResult {
  processed: number
  failed: number
  errors: { familyId: string; error: string }[]
}

export interface FamilyChunkOptions {
  name: string
  organizationId: string
  batchSize?: number
  familyCursor?: string | null
  /** Where to POST the next family batch. Should be a fully-qualified URL. */
  selfUrl: string
  /** When false, process one batch without firing continuation (sync loops). */
  triggerContinuation?: boolean
  /** Extra query params preserved on continuation (e.g. year/month). */
  continuationParams?: Record<string, string>
  /** Process one family. Throw to record failure (loop continues). */
  perFamily: (family: { _id: Types.ObjectId; name?: string }) => Promise<void>
  metadata?: Record<string, unknown>
}

/**
 * Run one chunk of families for an org and (if more remain) trigger the
 * next batch via fire-and-forget HTTP.
 */
export async function runChunkedFamilies(
  opts: FamilyChunkOptions,
): Promise<
  FamilyChunkResult & { hasMore: boolean; familyCursorOut: string | null; jobRunId: string }
> {
  await connectDB()

  const batchSize = opts.batchSize ?? DEFAULT_FAMILY_BATCH_SIZE
  const familyCursor = opts.familyCursor || null
  const triggerContinuation = opts.triggerContinuation !== false

  const jobRun = await JobRun.create({
    name: opts.name,
    status: 'running',
    startedAt: new Date(),
    cursorIn: familyCursor,
    metadata: { organizationId: opts.organizationId, ...(opts.metadata || {}) },
  })

  const query: Record<string, unknown> = { organizationId: opts.organizationId }
  if (familyCursor && Types.ObjectId.isValid(familyCursor)) {
    query._id = { $gt: new Types.ObjectId(familyCursor) }
  }
  const families = await Family.find(query)
    .sort({ _id: 1 })
    .limit(batchSize + 1)
    .select('_id name')
    .lean<{ _id: Types.ObjectId; name?: string }[]>()

  const hasMore = families.length > batchSize
  const batch = hasMore ? families.slice(0, batchSize) : families
  const familyCursorOut = hasMore ? batch[batch.length - 1]._id.toString() : null

  const result: FamilyChunkResult = { processed: 0, failed: 0, errors: [] }

  for (const family of batch) {
    const familyId = family._id.toString()
    try {
      await opts.perFamily(family)
      result.processed += 1
    } catch (err: any) {
      result.failed += 1
      if (result.errors.length < MAX_RECORDED_ERRORS) {
        result.errors.push({ familyId, error: err?.message || String(err) })
      }
    }
  }

  await JobRun.findByIdAndUpdate(jobRun._id, {
    status: 'completed',
    completedAt: new Date(),
    cursorOut: familyCursorOut,
    processed: result.processed,
    failed: result.failed,
    errors: result.errors,
    lastError: result.errors[result.errors.length - 1]?.error,
  })

  if (triggerContinuation && hasMore && familyCursorOut) {
    triggerNextBatch(opts.selfUrl, familyCursorOut, {
      cursorParam: 'familyCursor',
      extraParams: {
        organizationId: opts.organizationId,
        ...(opts.continuationParams || {}),
      },
    }).catch((err) => {
      logError(err, { module: 'jobs', job: opts.name, phase: 'next-family-batch' })
    })
  }

  return { ...result, hasMore, familyCursorOut, jobRunId: jobRun._id.toString() }
}

interface TriggerNextBatchOptions {
  cursorParam?: string
  extraParams?: Record<string, string>
}

async function triggerNextBatch(
  selfUrl: string,
  cursor: string,
  opts?: TriggerNextBatchOptions,
): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Without CRON_SECRET the follow-up request would 401 and the rest
    // of the chunked job would silently never run — every org past the
    // first batch would be skipped. Surface this loudly so ops sees the
    // misconfiguration the next time the cron fires instead of finding
    // out via "statements went out for January but not February".
    throw new Error(
      `CRON_SECRET is not set; cannot trigger next batch for ${selfUrl}. ` +
        `Set the env var so chunked jobs can self-continue.`,
    )
  }

  const u = new URL(selfUrl)
  u.searchParams.set(opts?.cursorParam || 'cursor', cursor)
  if (opts?.extraParams) {
    for (const [key, value] of Object.entries(opts.extraParams)) {
      if (value != null && value !== '') u.searchParams.set(key, value)
    }
  }

  // Use a short timeout — we don't actually care about the response,
  // just that the request got out the door.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: {
        'x-cron-secret': secret,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(
        `Next batch trigger failed (${res.status}) for ${selfUrl}: ${body.slice(0, 200)}`,
      )
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build a Mongo filter expression for "today is this org's configured
 * monthly-statement day, on the Gregorian branch". Used as one half of
 * `monthlyStatementScheduleMatcher`.
 *
 * Special case (end-of-month clamp): when today is the LAST day of the
 * current Gregorian month (e.g. Feb 28 in a non-leap year, or Apr 30),
 * we also match orgs whose preferred day exceeds today. That covers an
 * org that picked day=31 in February: their statement fires on Feb 28
 * instead of being skipped.
 *
 * `now` is injectable so tests can pin a specific date.
 */
export function monthlyStatementDayMatcher(now: Date = new Date()): Record<string, unknown> {
  const day = now.getDate()
  // `new Date(y, m+1, 0)` gives the last day of month `m` (zero-indexed).
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  if (day === lastDayOfMonth) {
    return { monthlyStatementDay: { $gte: day } }
  }
  return { monthlyStatementDay: day }
}

/**
 * Build a Mongo filter expression for "today is this org's configured
 * monthly-statement day, on the Hebrew branch". Used as the other half
 * of `monthlyStatementScheduleMatcher`.
 *
 * Hebrew months have either 29 or 30 days. Same clamp idea as the
 * Gregorian helper: if today is the last day of the current Hebrew
 * month (29 in a short month), also match orgs whose configured Hebrew
 * day is 30 — otherwise they'd silently skip every short month.
 *
 * `now` is injectable so tests can pin a specific date.
 */
export function monthlyStatementHebrewDayMatcher(now: Date = new Date()): Record<string, unknown> {
  // Hebrew days start at *sunset*, so `new HDate(now)` is technically
  // off by up to ~7 hours during the post-sunset window. We accept that
  // imprecision for batch-scheduled emails (it just means a few orgs
  // see the statement go out a few hours earlier on the right local
  // day). For per-tenant precision callers should compose this matcher
  // with `startOfDayInTimeZone(org.timezone)` and bias `now` accordingly.
  const today = new HDate(now)
  const day = today.getDate()
  const lastDayOfMonth = today.daysInMonth() // 29 or 30
  if (day === lastDayOfMonth) {
    return { monthlyStatementHebrewDay: { $gte: day } }
  }
  return { monthlyStatementHebrewDay: day }
}

/**
 * Combined Greg/Heb schedule matcher. Returns a Mongo `$or` filter that
 * matches an org iff (today's day in that org's chosen calendar) ==
 * (that org's configured day-of-month).
 *
 * Use this as the `orgFilter` for both monthly-statement cron routes:
 *
 *   orgFilter: {
 *     monthlyStatementAutoGenerate: true,
 *     ...monthlyStatementScheduleMatcher(),
 *   }
 *
 * Orgs whose `monthlyStatementCalendar` is missing are treated as
 * 'gregorian' — that's the historical default and what existing rows
 * have until they're touched.
 */
export function monthlyStatementScheduleMatcher(
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    $or: [
      {
        // Treat missing calendar as 'gregorian' for back-compat with rows
        // that predate the Hebrew option.
        $and: [
          {
            $or: [
              { monthlyStatementCalendar: 'gregorian' },
              { monthlyStatementCalendar: { $exists: false } },
              { monthlyStatementCalendar: null },
            ],
          },
          monthlyStatementDayMatcher(now),
        ],
      },
      {
        $and: [
          { monthlyStatementCalendar: 'hebrew' },
          monthlyStatementHebrewDayMatcher(now),
        ],
      },
    ],
  }
}

export interface MonthlyStatementOrgFields {
  timezone?: string | null
  monthlyStatementCalendar?: 'gregorian' | 'hebrew' | null
  monthlyStatementDay?: number | null
  monthlyStatementHebrewDay?: number | null
}

/**
 * Whether `ref` is the org's configured monthly-statement day in the
 * org's wall-clock timezone (with end-of-month clamping). Cron routes
 * should use this per-org instead of `monthlyStatementScheduleMatcher`,
 * which keys off the server's local/UTC day and mis-fires for distant
 * timezones.
 */
export function orgMatchesMonthlyStatementSchedule(
  org: MonthlyStatementOrgFields,
  ref: Date = new Date(),
): boolean {
  const calendar = org.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian'
  if (calendar === 'hebrew') {
    const today = new HDate(startOfDayInTimeZone(org.timezone, ref))
    const day = today.getDate()
    const configured = org.monthlyStatementHebrewDay ?? 1
    const lastDay = today.daysInMonth()
    if (day === lastDay && configured >= day) return true
    return day === configured
  }
  const day = getDayInTimeZone(org.timezone, ref)
  const configured = org.monthlyStatementDay ?? 1
  const year = getYearInTimeZone(org.timezone, ref)
  const month = getMonthInTimeZone(org.timezone, ref)
  const lastDay = new Date(year, month, 0).getDate()
  if (day === lastDay && configured >= day) return true
  return day === configured
}

export interface CycleConfigScheduleFields {
  cycleCalendar?: 'gregorian' | 'hebrew' | null
  cycleStartMonth?: number | null
  cycleStartDay?: number | null
  cycleStartHebrewMonth?: number | null
  cycleStartHebrewDay?: number | null
}

/** Whether `ref` matches a cycle config's start date in the org timezone. */
export function cycleConfigMatchesSchedule(
  config: CycleConfigScheduleFields,
  timezone: string | undefined | null,
  ref: Date = new Date(),
): boolean {
  const calendar = config.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian'
  if (calendar === 'hebrew') {
    const today = new HDate(startOfDayInTimeZone(timezone, ref))
    const month = today.getMonth()
    const day = today.getDate()
    const configuredMonth = config.cycleStartHebrewMonth ?? 7
    const configuredDay = config.cycleStartHebrewDay ?? 1
    if (month !== configuredMonth) return false
    const lastDay = today.daysInMonth()
    if (day === lastDay && configuredDay >= day) return true
    return day === configuredDay
  }
  const month = getMonthInTimeZone(timezone, ref)
  const day = getDayInTimeZone(timezone, ref)
  const configuredMonth = config.cycleStartMonth ?? 1
  const configuredDay = config.cycleStartDay ?? 1
  if (month !== configuredMonth) return false
  const year = getYearInTimeZone(timezone, ref)
  const lastDay = new Date(year, month, 0).getDate()
  if (day === lastDay && configuredDay >= day) return true
  return day === configuredDay
}

/**
 * Build a Mongo filter for "today matches this org's configured cycle
 * start date on the Gregorian branch" — used as one half of
 * `cycleScheduleMatcher`. Note these fields live on the `CycleConfig`
 * doc, NOT the Organization doc, so this matcher is consumed by the
 * cycle-rollover job's own per-org loop (see lib/cycle-rollover.ts),
 * not by `runChunked`'s top-level Organization filter.
 *
 * Cycle is once a year (unlike monthly statements which are once a
 * month) so both the month AND the day must match. End-of-month clamp:
 * if today is the LAST day of the configured cycle month, also match
 * configured days that exceed today — that covers an org that picked
 * Feb 30 (e.g. cycleStartMonth=2, cycleStartDay=30 in a non-leap year).
 */
export function cycleStartGregorianMatcher(now: Date = new Date()): Record<string, unknown> {
  const month = now.getMonth() + 1 // 1–12
  const day = now.getDate()
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  if (day === lastDayOfMonth) {
    return { cycleStartMonth: month, cycleStartDay: { $gte: day } }
  }
  return { cycleStartMonth: month, cycleStartDay: day }
}

/**
 * Hebrew branch of the cycle-start matcher. Both Hebrew month AND
 * Hebrew day must match today's Hebrew date. End-of-month clamp covers
 * 29-day Hebrew months when the org picked day 30.
 *
 * Note: month 13 (Adar II) only exists in leap years. In a non-leap
 * year, Hebcal reports month 12 (Adar) for what would be Adar II, so
 * an org that configured month 13 simply doesn't fire that year — that
 * matches reality and is the correct behavior (there is no Adar II
 * cycle start in a regular year).
 */
export function cycleStartHebrewMatcher(now: Date = new Date()): Record<string, unknown> {
  const today = new HDate(now)
  const month = today.getMonth() // 1–13
  const day = today.getDate()
  const lastDayOfMonth = today.daysInMonth() // 29 or 30
  if (day === lastDayOfMonth) {
    return { cycleStartHebrewMonth: month, cycleStartHebrewDay: { $gte: day } }
  }
  return { cycleStartHebrewMonth: month, cycleStartHebrewDay: day }
}

/**
 * Combined Greg/Heb cycle-start matcher. Returns a `$or` filter
 * suitable for matching `CycleConfig` documents:
 *
 *   await CycleConfig.find({
 *     isActive: true,
 *     cycleAutoRollover: true,
 *     ...cycleScheduleMatcher(),
 *   })
 *
 * Missing `cycleCalendar` is treated as 'gregorian' for back-compat
 * with rows that predate the Hebrew option.
 */
export function cycleScheduleMatcher(now: Date = new Date()): Record<string, unknown> {
  return {
    $or: [
      {
        $and: [
          {
            $or: [
              { cycleCalendar: 'gregorian' },
              { cycleCalendar: { $exists: false } },
              { cycleCalendar: null },
            ],
          },
          cycleStartGregorianMatcher(now),
        ],
      },
      {
        $and: [
          { cycleCalendar: 'hebrew' },
          cycleStartHebrewMatcher(now),
        ],
      },
    ],
  }
}

/**
 * Pick a stable "cycle year" identifier for a rollover happening at
 * `chargeDate` on the given calendar. For Gregorian this is just the
 * Gregorian year; for Hebrew it's the Hebrew year (e.g. 5786). Used
 * for the unique idempotency key on `CycleCharge`.
 */
export function cycleYearFor(
  calendar: 'gregorian' | 'hebrew',
  chargeDate: Date = new Date(),
  timezone?: string | null,
): number {
  if (calendar === 'hebrew') {
    return new HDate(startOfDayInTimeZone(timezone, chargeDate)).getFullYear()
  }
  return getYearInTimeZone(timezone, chargeDate)
}

/**
 * Build the absolute URL used for self-recursion. Prefers an explicit
 * env override, then standard Vercel/Next env vars, then localhost.
 */
export function selfUrl(request: Request, path: string): string {
  const override = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL
  if (override) return new URL(path, override).toString()

  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel}${path}`

  // Best-effort fallback derived from the incoming request.
  const url = new URL(request.url)
  return `${url.origin}${path}`
}
