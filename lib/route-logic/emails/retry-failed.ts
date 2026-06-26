/**
 * POST /api/emails/retry-failed
 *
 * Re-send all failed EmailMessage rows for a communications campaign or job.
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { EmailJob, EmailMessage } from '@/lib/models'
import { sendEmail } from '@/lib/mail'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { objectId } from '@/lib/schemas/common'

export const dynamic = 'force-dynamic'

const retryFailedBody = z
  .object({
    campaignId: objectId.optional(),
    jobId: objectId.optional(),
  })
  .refine((v) => Boolean(v.campaignId || v.jobId), {
    message: 'campaignId or jobId is required',
  })

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: retryFailedBody,
  name: 'POST /api/emails/retry-failed',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-retry-failed',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    let campaignId: string | null = body.campaignId ?? null

    if (body.jobId) {
      const job = await EmailJob.findOne({
        _id: body.jobId,
        organizationId: ctx!.organizationId,
        kind: 'communications',
      }).lean<{ payload?: { campaignId?: string } }>()

      if (!job) return { status: 404, data: { error: 'Job not found' } }

      const fromJob = job.payload?.campaignId
      if (!fromJob) {
        return { status: 400, data: { error: 'Job has no campaignId in payload' } }
      }
      if (campaignId && campaignId !== fromJob) {
        return { status: 400, data: { error: 'campaignId does not match job payload' } }
      }
      campaignId = fromJob
    }

    const filter = {
      organizationId: new Types.ObjectId(ctx!.organizationId),
      campaignId: new Types.ObjectId(campaignId!),
      status: 'failed' as const,
    }

    const failedRows = await EmailMessage.find(filter)
      .select('to subject html text kind familyId campaignId openTracking clickTracking')
      .lean<any[]>()

    if (failedRows.length === 0) {
      return { data: { retried: 0, sent: 0, failed: 0, errors: [] as string[] } }
    }

    let sent = 0
    let failed = 0
    const errors: string[] = []

    for (const row of failedRows) {
      if (!row.html?.trim() && !row.text?.trim()) {
        failed++
        if (errors.length < 50) {
          errors.push(`${row.to}: Email content is not available for retry`)
        }
        continue
      }

      const result = await sendEmail({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        familyId: row.familyId ? String(row.familyId) : null,
        to: row.to,
        subject: row.subject,
        html: row.html,
        text: row.text,
        kind: row.kind,
        campaignId: row.campaignId ? String(row.campaignId) : campaignId!,
        tracking: { opens: row.openTracking, clicks: row.clickTracking },
        auditRequest: request,
      })

      if (result.ok) sent++
      else {
        failed++
        if (errors.length < 50) {
          errors.push(`${row.to}: ${result.error || 'Retry failed'}`)
        }
      }
    }

    return {
      data: {
        retried: failedRows.length,
        sent,
        failed,
        errors,
        campaignId,
      },
    }
  },
})
