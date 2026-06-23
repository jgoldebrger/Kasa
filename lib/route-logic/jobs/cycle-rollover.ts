import { handler } from '@/lib/api/handler'
import { CycleConfig, JobRun, Organization } from '@/lib/models'
import { cycleConfigMatchesSchedule } from '@/lib/jobs'
import { runCycleRolloverForOrg, type RolloverResult } from '@/lib/cycle-rollover'
import { acquireCronLock } from '@/lib/cron-lock'
import { logError } from '@/lib/log'
import { reportCronBatchFailures } from '@/lib/cron-alerts'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'

const JOB_NAME = 'cycle-rollover'

function sanitizeJobErrors(errors: { orgId: string; error: string }[]) {
  const capped = errors.slice(0, 20)
  if (process.env.NODE_ENV !== 'production') return capped
  return capped.map((e) => ({
    orgId: e.orgId,
    error: sanitizeStripeErrorMessage(e.error) || 'Processing failed',
  }))
}

/**
 * Cron-triggered. Runs DAILY at 1 AM UTC and for each organization
 * whose CycleConfig:
 *   (a) has `cycleAutoRollover: true`, AND
 *   (b) has a cycle-start date that matches today in its chosen
 *       calendar (Gregorian or Hebrew, see `cycleScheduleMatcher`),
 * writes one `CycleCharge` per family with the family's current plan
 * yearlyPrice. Idempotent via the partial unique index on
 * (organizationId, familyId, cycleYear) — re-running on the same day
 * is a no-op.
 *
 * Unlike the monthly-statement crons we do NOT need `runChunked`'s
 * cursor pagination here: the rollover only fires once a year per org,
 * so on any given day the matching CycleConfig set is tiny (usually
 * 0–5 orgs across the whole platform). We just iterate them directly.
 *
 * Secured by `CRON_SECRET` (via `x-cron-secret` header or
 * `Authorization: Bearer`).
 */
export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/cycle-rollover',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-cycle-rollover', {
      limit: 30,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    // Distributed lock keyed by the current UTC date. Vercel Cron is
    // at-least-once delivery, so two ticks can land within a few seconds
    // of each other — without this guard both would scan the same
    // CycleConfig set and call `runCycleRolloverForOrg` twice for every
    // matching tenant. The downstream rollover is idempotent on a unique
    // index, so duplicate charges are blocked at the DB layer anyway,
    // but holding a lock saves the redundant Mongo round trips and makes
    // JobRun rows readable (one per logical tick instead of N).
    const lockKey = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const lock = await acquireCronLock(JOB_NAME, lockKey, { ttlMs: 15 * 60 * 1000 })
    if (!lock) {
      return {
        data: {
          jobRunId: null,
          skipped: true,
          reason: 'Another cycle-rollover run is already in progress for today',
        },
      }
    }

    const jobRun = await JobRun.create({
      name: JOB_NAME,
      status: 'running',
      startedAt: new Date(),
      metadata: { lockKey },
    })

    try {
      const allConfigs = await loadAllByIdCursor<{
        _id: unknown
        organizationId: unknown
        cycleCalendar?: 'gregorian' | 'hebrew' | null
        cycleStartMonth?: number | null
        cycleStartDay?: number | null
        cycleStartHebrewMonth?: number | null
        cycleStartHebrewDay?: number | null
      }>(
        (filter, limit) =>
          CycleConfig.find(filter)
            .select(
              'organizationId cycleCalendar cycleStartMonth cycleStartDay cycleStartHebrewMonth cycleStartHebrewDay',
            )
            .sort({ _id: 1 })
            .limit(limit)
            .lean(),
        { isActive: true, cycleAutoRollover: true },
      )

      const orgIds = [...new Set(allConfigs.map((c) => String(c.organizationId)))]
      const orgRows = await Organization.find({ _id: { $in: orgIds } })
        .select('_id timezone')
        .lean<{ _id: any; timezone?: string | null }[]>()
      const tzByOrg = new Map(orgRows.map((o) => [String(o._id), o.timezone]))

      const now = new Date()
      const configs = allConfigs.filter((cfg) =>
        cycleConfigMatchesSchedule(cfg, tzByOrg.get(String(cfg.organizationId)), now),
      )

      const results: RolloverResult[] = []
      const errors: { orgId: string; error: string }[] = []
      let processed = 0
      let failed = 0

      for (const cfg of configs) {
        const orgId = String(cfg.organizationId)
        try {
          const r = await runCycleRolloverForOrg(orgId)
          results.push(r)
          processed += 1
        } catch (err: any) {
          failed += 1
          errors.push({ orgId, error: err?.message || String(err) })
          logError(err, { module: 'jobs', job: JOB_NAME, organizationId: orgId })
        }
      }

      await JobRun.findByIdAndUpdate(jobRun._id, {
        status: 'completed',
        completedAt: new Date(),
        processed,
        failed,
        errors,
        lastError: errors[errors.length - 1]?.error,
        metadata: {
          matchedConfigs: configs.length,
          // Per-org totals — small enough to inline on the JobRun doc
          // and useful for the audit log / debugging without a join.
          results: results.map((r) => ({
            organizationId: r.organizationId,
            cycleYear: r.cycleYear,
            calendar: r.calendar,
            charged: r.charged,
            skipped: r.skipped,
            noPlan: r.noPlan,
            errorCount: r.errors.length,
          })),
        },
      })

      if (failed > 0) {
        reportCronBatchFailures({
          jobName: JOB_NAME,
          jobRunId: jobRun._id.toString(),
          failed,
          processed,
          errors,
          status: 'completed',
        })
      }

      return {
        data: {
          jobRunId: jobRun._id.toString(),
          matchedConfigs: configs.length,
          processed,
          failed,
          errors: sanitizeJobErrors(errors),
          results,
        },
      }
    } catch (err: any) {
      await JobRun.findByIdAndUpdate(jobRun._id, {
        status: 'failed',
        completedAt: new Date(),
        lastError: err?.message || String(err),
      })
      reportCronBatchFailures({
        jobName: JOB_NAME,
        jobRunId: jobRun._id.toString(),
        failed: 1,
        status: 'failed',
      })
      logError(err, { module: 'jobs', job: JOB_NAME })
      throw err
    } finally {
      await lock.release()
    }
  },
})

// Vercel Cron sometimes uses GET; accept both.
export const GET = POST
