/**
 * GET /api/statements/send-emails/status?jobId=<id>
 *
 * Returns the current state of an EmailJob so the client can poll the
 * "Send via Email" progress without re-running the work itself.
 */

import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { EmailJob } from '@/lib/models'
import { EMAIL_JOB_STALE_AFTER_MS } from '@/lib/email-jobs'
import { checkRateLimit } from '@/lib/rate-limit'
import { sanitizeBatchErrors, sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/statements/send-emails/status',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'send-emails-status',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const jobId = new URL(request.url).searchParams.get('jobId')?.trim()
    if (!jobId || !Types.ObjectId.isValid(jobId)) {
      return { status: 400, data: { error: 'Invalid jobId' } }
    }

    const job = await EmailJob.findOne({
      _id: jobId,
      organizationId: ctx!.organizationId,
    })

    if (!job) return { status: 404, data: { error: 'Job not found' } }

    // Surface stuck jobs immediately on poll. If the worker's
    // self-trigger fetch was lost, the document sits in `running` with
    // no other writer to advance it; the kickoff-route sweep only
    // fires when the next bulk run starts (often the next day). For
    // admins polling RIGHT NOW, transparently flip the row to
    // `failed` so they see the actual state instead of an eternal
    // "processed: 47/200" with no movement.
    if (
      job.status === 'running' &&
      job.updatedAt &&
      Date.now() - new Date(job.updatedAt).getTime() > EMAIL_JOB_STALE_AFTER_MS
    ) {
      await EmailJob.updateOne(
        { _id: jobId, organizationId: ctx!.organizationId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            lastError:
              job.lastError ||
              'Job auto-failed: no progress for ' +
                Math.round(EMAIL_JOB_STALE_AFTER_MS / 60000) +
                ' minutes (worker continuation likely lost).',
          },
        },
      ).catch(() => {})
      job.status = 'failed'
      job.completedAt = new Date()
    }

    return {
      data: {
        jobId: String(job._id),
        status: job.status,
        totalFamilies: job.totalFamilies,
        processed: job.processed,
        sent: job.sent,
        failed: job.failed,
        remaining: Array.isArray(job.pending) ? job.pending.length : 0,
        errors: sanitizeBatchErrors(
          (job.errors || []).map((e: any) => `${e.email || e.familyId}: ${e.error}`),
        ),
        lastError: job.lastError ? sanitizeStripeErrorMessage(job.lastError) : null,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        done: job.status === 'completed' || job.status === 'failed',
      },
    }
  },
})
