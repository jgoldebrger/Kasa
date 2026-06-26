/**
 * GET /api/emails/send-bulk/status?jobId=<id>
 *
 * Returns the current state of a communications EmailJob so the client
 * can poll bulk-send progress without re-running the work.
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
  name: 'GET /api/emails/send-bulk/status',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'communications-email-status',
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
      kind: 'communications',
    })

    if (!job) return { status: 404, data: { error: 'Job not found' } }

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

    const payload = job.payload as { campaignId?: string; subject?: string } | undefined

    return {
      data: {
        jobId: String(job._id),
        status: job.status,
        campaignId: payload?.campaignId ?? null,
        subject: payload?.subject ?? null,
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
