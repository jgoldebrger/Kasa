/**
 * EmailJob lifecycle helpers.
 *
 * The chunked email worker (statements + tax-receipts) writes per-batch
 * progress to an `EmailJob` row and self-triggers the next tick over
 * HTTP. If a continuation fetch fails to land — function timeout,
 * dropped serverless cold start, network blip — the row is permanently
 * stuck in `status: 'running'`:
 *
 *   - Admin polling `/api/statements/send-emails/status` sees
 *     "running, processed: 47/200" forever.
 *   - Daily cron just creates more EmailJob rows; the old ones never
 *     get retried.
 *   - No TTL on the schema, so they accumulate forever.
 *
 * `sweepStaleEmailJobs` runs at the kickoff entry points and on status
 * polls to mark anything that's been silent for `STALE_AFTER_MS` as
 * `failed`. Threshold is chosen for the worst-case healthy job: a 500-
 * family statement run with BATCH_SIZE=5 finishes in ~25 minutes, so
 * 30 minutes of silence is the conservative "truly stuck" line.
 */

import { EmailJob } from './models'
import { Types } from 'mongoose'
import { selfUrl } from './jobs'
import { UNBOUNDED_LIST_CAP } from './schemas/common'
import type { NextRequest } from 'next/server'

export type EmailJobKind = 'statements' | 'tax-receipts' | 'communications'

export const EMAIL_JOB_STALE_AFTER_MS = 30 * 60 * 1000

export interface SweepResult {
  swept: number
  jobIds: string[]
}

/**
 * Mark `running` EmailJob rows that haven't been touched in
 * `staleAfterMs` (default 30 min) as `failed`.
 *
 * - `organizationId` and `kind` can be supplied to narrow the scope so
 *   the statements-kickoff doesn't fail a tax-receipts job that's
 *   legitimately mid-flight (or vice versa).
 * - Idempotent: re-running picks up nothing if all stuck jobs have
 *   already been marked failed.
 */
/** Return an in-flight EmailJob for the org/kind, if any. */
export async function findActiveEmailJob(opts: {
  organizationId: string
  kind: EmailJobKind
}): Promise<{ _id: unknown; status: string } | null> {
  return EmailJob.findOne({
    organizationId: new Types.ObjectId(opts.organizationId),
    kind: opts.kind,
    status: { $in: ['queued', 'running'] },
  })
    .select('_id status')
    .lean<{ _id: unknown; status: string }>()
}

export async function sweepStaleEmailJobs(
  opts: {
    organizationId?: string
    kind?: EmailJobKind
    staleAfterMs?: number
  } = {},
): Promise<SweepResult> {
  const staleAfterMs = opts.staleAfterMs ?? EMAIL_JOB_STALE_AFTER_MS
  const cutoff = new Date(Date.now() - staleAfterMs)

  const filter: Record<string, unknown> = {
    status: 'running',
    updatedAt: { $lt: cutoff },
  }
  if (opts.organizationId) filter.organizationId = opts.organizationId
  if (opts.kind) filter.kind = opts.kind

  let totalSwept = 0
  const allIds: unknown[] = []
  for (;;) {
    const stuck = await EmailJob.find(filter)
      .select('_id')
      .limit(UNBOUNDED_LIST_CAP)
      .lean<{ _id: unknown }[]>()
    if (stuck.length === 0) break

    const ids = stuck.map((s) => s._id)
    await EmailJob.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'failed',
          completedAt: new Date(),
          lastError:
            'Job auto-failed: no progress for ' +
            Math.round(staleAfterMs / 60000) +
            ' minutes (worker continuation likely lost).',
        },
      },
    )
    allIds.push(...ids)
    totalSwept += stuck.length
    if (stuck.length < UNBOUNDED_LIST_CAP) break
  }
  if (totalSwept === 0) return { swept: 0, jobIds: [] }

  return { swept: totalSwept, jobIds: allIds.map((i) => String(i)) }
}

/**
 * Fire-and-forget the first worker tick for a queued EmailJob. On
 * failure marks the job `failed` so callers don't return 202 for a job
 * that will never start.
 */
export async function kickoffEmailWorker(opts: {
  request: NextRequest
  workerPath: string
  jobId: string
  organizationId: string
  body: Record<string, unknown>
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = selfUrl(opts.request, opts.workerPath)
  const secret = process.env.CRON_SECRET || ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-cron-secret': secret } : {}),
        cookie: opts.request.headers.get('cookie') || '',
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const msg = `Worker kickoff HTTP ${res.status}: ${text.slice(0, 200)}`
      await EmailJob.findByIdAndUpdate(opts.jobId, {
        $set: { status: 'failed', completedAt: new Date(), lastError: msg },
      })
      return { ok: false, error: msg }
    }
    return { ok: true }
  } catch (err: any) {
    const msg = err?.message || 'Worker kickoff failed'
    await EmailJob.findByIdAndUpdate(opts.jobId, {
      $set: { status: 'failed', completedAt: new Date(), lastError: msg },
    })
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
