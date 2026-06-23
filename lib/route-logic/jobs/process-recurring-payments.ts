import { handler } from '@/lib/api/handler'
import { runChunked, selfUrl } from '@/lib/jobs'
import { acquireCronLock } from '@/lib/cron-lock'
import { JobLock } from '@/lib/models'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'
import { processRecurringPaymentsForOrg } from '@/lib/recurring-payments/process-org'

const JOB_NAME = 'process-recurring-payments'
const JOB_PATH = '/api/jobs/process-recurring-payments'

/**
 * Cron-triggered. Iterates organizations in batches and charges any
 * due RecurringPayment rows via Stripe per org.
 *
 * Calls `processRecurringPaymentsForOrg` in-process (no HTTP hop) so
 * Vercel Deployment Protection cannot block internal self-calls.
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
    }

    let releaseLock = false
    try {
      const result = await runChunked({
        name: JOB_NAME,
        cursor,
        selfUrl: selfUrl(request, JOB_PATH),
        perOrg: async (organizationId) => {
          await processRecurringPaymentsForOrg(organizationId)
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
