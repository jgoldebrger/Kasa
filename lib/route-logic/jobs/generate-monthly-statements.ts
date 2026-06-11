import { handler } from '@/lib/api/handler'
import { runChunked, selfUrl, orgMatchesMonthlyStatementSchedule, type MonthlyStatementOrgFields } from '@/lib/jobs'
import { acquireCronLock } from '@/lib/cron-lock'
import { JobLock, Organization } from '@/lib/models'
import { generateMonthlyStatements } from '@/lib/scheduler'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'

const JOB_NAME = 'generate-monthly-statements'
const JOB_PATH = '/api/jobs/generate-monthly-statements'
const WORKER_PATH = '/api/jobs/generate-monthly-statements/worker'

/**
 * Cron-triggered. Iterates organizations in batches and generates the
 * previous-month statement for each family in each org.
 *
 * Secured by `CRON_SECRET` (via `x-cron-secret` header or
 * `Authorization: Bearer`). Vercel Cron sends Bearer automatically.
 *
 * Runs DAILY at 2 AM UTC. Each tick only acts on orgs that
 *   (a) opted in via `monthlyStatementAutoGenerate`, AND
 *   (b) today matches the org's configured day-of-month in its chosen
 *       calendar (Gregorian or Hebrew). See `monthlyStatementScheduleMatcher`
 *       in lib/jobs.ts — both branches do end-of-month clamping so an org
 *       whose chosen day exceeds the current month length still fires on
 *       the last day of that month.
 *
 * Pagination: pass `?cursor=<orgId>` to resume org batches; the handler
 * self-calls for the next org batch when more orgs remain. Within each
 * org, families are processed in batches of 5 via the worker route
 * (`/api/jobs/generate-monthly-statements/worker`) which self-continues
 * with `?organizationId=&familyCursor=` until the org is complete.
 */
export const POST = handler({
  auth: 'cron',
  name: 'POST /api/jobs/generate-monthly-statements',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-generate-monthly-statements', {
      limit: 120,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const cursor = new URL(request.url).searchParams.get('cursor')

    // Chain-wide distributed lock. Vercel cron is at-least-once: without
    // this lock, two ticks colliding on the same day each kicked off a
    // full org-chunked chain that re-generated every family's statement
    // a second time (the per-period unique index prevents duplicate rows,
    // but the wasted Mongo writes and PDF work were observable). Only the
    // first batch (cursor=null) takes the lock; the final batch releases
    // by key.
    const lockKey = new Date().toISOString().slice(0, 10)
    if (!cursor) {
      const lock = await acquireCronLock(JOB_NAME, lockKey, { ttlMs: 60 * 60 * 1000 })
      if (!lock) {
        return {
          data: {
            skipped: true,
            reason: `Another ${JOB_NAME} run is already in progress for today`,
          },
        }
      }
    }

    let releaseLock = false
    try {
      const result = await runChunked({
        name: JOB_NAME,
        cursor,
        selfUrl: selfUrl(request, JOB_PATH),
        // Only orgs that opted in via Settings → Automation participate AND
        // whose configured day-of-month (in their chosen calendar) matches
        // today. Existing orgs default to `monthlyStatementAutoGenerate:
        // false`, so this is opt-in.
        orgFilter: { monthlyStatementAutoGenerate: true },
        perOrg: async (organizationId) => {
          const org = await Organization.findById(organizationId)
            .select(
              'timezone monthlyStatementCalendar monthlyStatementDay monthlyStatementHebrewDay',
            )
            .lean<MonthlyStatementOrgFields>()
          if (!org || !orgMatchesMonthlyStatementSchedule(org)) return
          await generateMonthlyStatements(organizationId, undefined, undefined, {
            selfUrl: selfUrl(request, WORKER_PATH),
          })
        },
      })
      if (!result.hasMore) releaseLock = true
      return { data: result }
    } catch (err: any) {
      releaseLock = true
      logError(err, { module: 'jobs', job: JOB_NAME })
      throw err
    } finally {
      if (releaseLock) {
        await JobLock.deleteOne({ jobName: JOB_NAME, lockKey }).catch(() => {})
      }
    }
  },
})

// Vercel Cron sometimes uses GET; accept both.
export const GET = POST
