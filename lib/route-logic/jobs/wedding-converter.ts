import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { FamilyMember, JobRun } from '@/lib/models'
import { withCronLock } from '@/lib/cron-lock'
import { convertMembersOnWeddingDate } from '@/lib/wedding-converter'
import { logError } from '@/lib/log'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'

const JOB_NAME = 'wedding-converter'

function sanitizeJobErrors(errors: { orgId: string; error: string }[]) {
  const capped = errors.slice(0, 20)
  if (process.env.NODE_ENV !== 'production') return capped
  return capped.map((e) => ({
    orgId: e.orgId,
    error: sanitizeStripeErrorMessage(e.error) || 'Processing failed',
  }))
}

/**
 * Cron-triggered. Runs DAILY and, for every organization with at least
 * one un-converted member whose `weddingDate` is on or before today,
 * runs `convertMembersOnWeddingDate(orgId)` — which turns the member
 * into a new family (with the org's `weddingConversionDefaultPlanId`,
 * if configured), moves their spouse onto the new family, and removes
 * the original member row.
 *
 * Idempotent because the per-org helper already filters by
 * `convertedToFamily: { $ne: true }` and deletes the source member at
 * the end of a successful conversion.
 *
 * Secured by `CRON_SECRET` (via `x-cron-secret` header or
 * `Authorization: Bearer`).
 */
export const POST = handler({
  auth: 'cron',
  name: 'POST /api/jobs/wedding-converter',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-wedding-converter', {
      limit: 30,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    // Daily distributed lock. Two simultaneous Vercel cron invocations
    // could both `.distinct()` the same set of members, then each call
    // `Family.create` for the same member before the source-member
    // delete inside `convertMembersOnWeddingDate` ran — producing
    // duplicate families for a single wedding conversion. Keying the
    // lock on the UTC date is fine: this job is once-a-day-globally,
    // and any per-org calendar nuance is handled inside the per-org
    // helper, not here.
    const lockKey = new Date().toISOString().slice(0, 10)
    const lockResult = await withCronLock(
      JOB_NAME,
      lockKey,
      async () => runJob(),
      { ttlMs: 60 * 60 * 1000 },
    )
    if (lockResult === null) {
      return {
        data: {
          skipped: true,
          reason: `Another ${JOB_NAME} run is already in progress for today`,
        },
      }
    }
    return lockResult
  },
})

async function runJob(): Promise<NextResponse> {
  const jobRun = await JobRun.create({
    name: JOB_NAME,
    status: 'running',
    startedAt: new Date(),
    metadata: {},
  })

  try {
    const orgIds: any[] = await FamilyMember.distinct('organizationId', {
      weddingDate: { $lte: new Date() },
      convertedToFamily: { $ne: true },
    })

    const results: { orgId: string; converted: number }[] = []
    const errors: { orgId: string; error: string }[] = []
    let processed = 0
    let failed = 0

    for (const oid of orgIds) {
      const orgId = String(oid)
      try {
        const r = await convertMembersOnWeddingDate(orgId)
        results.push({ orgId, converted: r.converted })
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
        matchedOrgs: orgIds.length,
        results,
      },
    })

    return NextResponse.json({
      jobRunId: jobRun._id.toString(),
      matchedOrgs: orgIds.length,
      processed,
      failed,
      errors: sanitizeJobErrors(errors),
      results,
    })
  } catch (err: any) {
    await JobRun.findByIdAndUpdate(jobRun._id, {
      status: 'failed',
      completedAt: new Date(),
      lastError: err?.message || String(err),
    })
    logError(err, { module: 'jobs', job: JOB_NAME })
    return NextResponse.json(
      { error: 'Job failed', ...(process.env.NODE_ENV !== 'production' && { details: err?.message }) },
      { status: 500 },
    )
  }
}

// Vercel Cron sometimes uses GET; accept both.
export const GET = POST
