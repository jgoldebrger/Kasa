import { handler } from '@/lib/api/handler'
import { runChunked, selfUrl, orgMatchesMonthlyStatementSchedule, type MonthlyStatementOrgFields } from '@/lib/jobs'
import { acquireCronLock } from '@/lib/cron-lock'
import { JobLock, Organization } from '@/lib/models'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'

const JOB_NAME = 'send-monthly-statements'
const JOB_PATH = '/api/jobs/send-monthly-statements'

/**
 * Cron-triggered. Iterates organizations in batches and emails each
 * org's previous-month statements to its families.
 *
 * Delegates to the existing per-org route via internal HTTP using
 * `CRON_SECRET` — this re-uses all the email composition + PDF logic
 * already in that handler rather than duplicating it here.
 *
 * Runs DAILY at 3 AM UTC (one hour after the generate cron so the
 * statements exist by the time we email them). Each tick only acts on
 * orgs that
 *   (a) opted in via `monthlyStatementAutoEmail`, AND
 *   (b) today matches the org's configured day-of-month in its chosen
 *       calendar (Gregorian or Hebrew). See `monthlyStatementScheduleMatcher`
 *       in lib/jobs.ts for the end-of-month clamp behavior.
 */
export const POST = handler({
  auth: 'cron',
  name: 'POST /api/jobs/send-monthly-statements',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-send-monthly-statements', {
      limit: 120,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const cursor = new URL(request.url).searchParams.get('cursor')
    const secret = process.env.CRON_SECRET!
    const base = selfUrl(request, '')

    // Chain-wide distributed lock. Critical here: Vercel cron is
    // at-least-once, and without a lock two ticks each kicked off a full
    // per-family email chain — families received DUPLICATE statement
    // emails. Only the first batch (cursor=null) acquires the lock; the
    // final batch (hasMore=false) releases by key.
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
        // Only orgs that opted in AND whose configured day matches today
        // (in the org's chosen calendar). See the matching
        // generate-monthly-statements route for details.
        orgFilter: { monthlyStatementAutoEmail: true },
        perOrg: async (organizationId) => {
          const org = await Organization.findById(organizationId)
            .select(
              'timezone monthlyStatementCalendar monthlyStatementDay monthlyStatementHebrewDay',
            )
            .lean<MonthlyStatementOrgFields>()
          if (!org || !orgMatchesMonthlyStatementSchedule(org)) return

          const u = new URL('/api/statements/send-monthly-emails', base)
          u.searchParams.set('organizationId', organizationId)
          const res = await fetch(u.toString(), {
            method: 'POST',
            headers: {
              'x-cron-secret': secret,
              'content-type': 'application/json',
            },
            body: '{}',
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
          }
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

export const GET = POST
