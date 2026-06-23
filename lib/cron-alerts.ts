/**
 * Cron job failure alerting — ships partial and total batch failures to Sentry
 * so ops sees issues before treasurers report them.
 */

import * as Sentry from '@sentry/nextjs'
import { logError } from '@/lib/log'
import { scrubSentryData } from '@/lib/sentry-scrub'

export interface CronBatchFailureContext {
  jobName: string
  jobRunId?: string
  failed: number
  processed?: number
  errors?: { orgId?: string; familyId?: string; error: string }[]
  cursorIn?: string | null
  status?: 'completed' | 'failed'
}

/**
 * Report cron batch issues to structured logs and Sentry (production only).
 */
export function reportCronBatchFailures(ctx: CronBatchFailureContext): void {
  if (ctx.failed <= 0 && ctx.status !== 'failed') return

  const summary =
    ctx.status === 'failed'
      ? `Cron job ${ctx.jobName} failed`
      : `Cron job ${ctx.jobName} completed with ${ctx.failed} failure(s)`

  const err = new Error(summary)
  logError(err, {
    module: 'jobs',
    job: ctx.jobName,
    jobRunId: ctx.jobRunId,
    failed: ctx.failed,
    processed: ctx.processed,
    cursorIn: ctx.cursorIn,
    tags: { cronJob: ctx.jobName },
  })

  if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
    Sentry.captureException(err, {
      level: ctx.status === 'failed' ? 'error' : 'warning',
      tags: { cronJob: ctx.jobName },
      extra: scrubSentryData({
        jobRunId: ctx.jobRunId,
        failed: ctx.failed,
        processed: ctx.processed,
        cursorIn: ctx.cursorIn,
        errorSample: ctx.errors?.slice(0, 5),
      }) as Record<string, unknown>,
    })
  }
}
