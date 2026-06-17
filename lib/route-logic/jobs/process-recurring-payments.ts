import { handler } from '@/lib/api/handler'
import { runChunked, selfUrl } from '@/lib/jobs'
import { acquireCronLock } from '@/lib/cron-lock'
import { JobLock } from '@/lib/models'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'

const JOB_NAME = 'process-recurring-payments'
const JOB_PATH = '/api/jobs/process-recurring-payments'

/**
 * Cron-triggered. Iterates organizations in batches and charges any
 * due RecurringPayment rows via Stripe per org.
 *
 * Delegates to the existing per-org route via internal HTTP using
 * `CRON_SECRET`. Re-uses the Stripe + payment-record + failure-task
 * logic already in that handler.
 */
export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/process-recurring-payments',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-process-recurring-payments', {
      limit: 120,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const cursor = new URL(request.url).searchParams.get('cursor')
    const secret = process.env.CRON_SECRET!
    const base = selfUrl(request, '')

    // Chain-wide distributed lock. Only the *first* batch (cursor=null)
    // acquires the lock; continuation batches inherit it implicitly. We
    // intentionally do NOT release the lock at the end of batch 1 — that
    // was the original bug, since it allowed a concurrent Vercel retry to
    // start a parallel chain while the first one was mid-flight, leading
    // to two cron chains racing over the same due RecurringPayment rows.
    // Instead, the *final* batch (hasMore === false) deletes the lock by
    // its deterministic (jobName, lockKey) tuple. Crashed/aborted chains
    // are cleaned up by the JobLock TTL index (we use a generous 1h TTL
    // so even long chains don't expire mid-run).
    const lockKey = new Date().toISOString().slice(0, 10)
    if (!cursor) {
      const lock = await acquireCronLock(JOB_NAME, lockKey, { ttlMs: 60 * 60 * 1000 })
      if (!lock) {
        return {
          data: {
            skipped: true,
            reason: 'Another process-recurring-payments run is already in progress for today',
          },
        }
      }
      // Note: we intentionally let `lock` go out of scope without releasing
      // it. The lock row in Mongo persists; final-batch cleanup is by key.
    }

    let releaseLock = false
    try {
      const result = await runChunked({
        name: JOB_NAME,
        cursor,
        selfUrl: selfUrl(request, JOB_PATH),
        perOrg: async (organizationId) => {
          const u = new URL('/api/recurring-payments/process', base)
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
      // Final batch in the chain — release the lock so the next day's
      // tick (or a same-day retry after legitimate failure) can run.
      if (!result.hasMore) releaseLock = true
      return { data: result }
    } catch (err: any) {
      // On exception, release the lock so an operator can retry instead
      // of waiting out the TTL.
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
