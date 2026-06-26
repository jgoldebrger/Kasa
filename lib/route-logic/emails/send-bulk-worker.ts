/**
 * POST /api/emails/send-bulk/worker
 *
 * Chunked worker for communications bulk EmailJob rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyApiCsrf } from '@/lib/csrf'
import { Types } from 'mongoose'
import connectDB from '@/lib/database'
import { requireOrg } from '@/lib/auth-helpers'
import { isCronRequest } from '@/lib/auth-cron'
import { EmailJob, EmailConfig, Family } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { sanitizeFromName } from '@/lib/email-from-name'
import { selfUrl } from '@/lib/jobs'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'
import { createTransportWithFallback } from '@/lib/mail/create-transport'
import { notifyAdmins } from '@/lib/notify'
import {
  parseBulkAttachments,
  sendBulkToFamily,
  type BulkEmailPayload,
} from '@/lib/route-logic/emails/send-bulk'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 5

function isQuotaError(error: string | undefined): boolean {
  return Boolean(error?.includes('Daily send quota exceeded'))
}

async function notifyJobFinished(opts: {
  organizationId: string
  jobId: string
  status: 'completed' | 'failed'
  sent: number
  failed: number
  lastError?: string | null
  campaignId?: string
}) {
  const isFailed = opts.status === 'failed'
  await notifyAdmins(opts.organizationId, {
    kind: isFailed ? 'email.job.failed' : 'email.job.completed',
    title: isFailed ? 'Bulk email job failed' : 'Bulk email job finished',
    body: isFailed
      ? opts.lastError || 'The communications email job did not complete.'
      : `${opts.sent} sent, ${opts.failed} failed.`,
    link: '/communications',
    metadata: {
      jobId: opts.jobId,
      campaignId: opts.campaignId ?? null,
      sent: opts.sent,
      failed: opts.failed,
      status: opts.status,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const csrfBlock = verifyApiCsrf(request)
    if (csrfBlock) return csrfBlock

    const rateVerdict = await checkRateLimit(request, 'communications-email-worker', {
      limit: 500,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    await connectDB()

    let organizationId: string | null = null
    const cron = isCronRequest(request)
    if (!cron) {
      const ctx = await requireOrg(request, { minRole: 'admin' })
      if (ctx instanceof NextResponse) return ctx
      organizationId = ctx.organizationId
    }

    const body = await request.json().catch(() => ({}))
    const { jobId } = body || {}
    if (!jobId || !Types.ObjectId.isValid(jobId)) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
    }

    if (cron) {
      const url = new URL(request.url)
      const orgFromBody = (body as { organizationId?: string })?.organizationId
      const orgFromQuery = url.searchParams.get('organizationId')
      const supplied = orgFromBody || orgFromQuery
      if (!supplied || !Types.ObjectId.isValid(String(supplied))) {
        return NextResponse.json(
          { error: 'Cron worker requires explicit organizationId (body or ?organizationId=)' },
          { status: 400 },
        )
      }
      organizationId = String(supplied)
    }

    const job = await EmailJob.findOne({ _id: jobId, organizationId, kind: 'communications' })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!organizationId || String(job.organizationId) !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return NextResponse.json({ status: job.status, done: true })
    }

    const payload = job.payload as BulkEmailPayload | undefined
    if (!payload?.subject || !payload?.html || !payload?.campaignId) {
      job.status = 'failed'
      job.lastError = 'Job payload is missing required fields'
      job.completedAt = new Date()
      await job.save()
      await notifyJobFinished({
        organizationId: String(job.organizationId),
        jobId: String(job._id),
        status: 'failed',
        sent: job.sent ?? 0,
        failed: job.failed ?? 0,
        lastError: job.lastError,
      })
      return NextResponse.json({ status: 'failed', error: job.lastError })
    }

    if (job.status === 'queued') {
      job.status = 'running'
      job.startedAt = job.startedAt || new Date()
      await job.save()
    }

    const cfgDoc = await EmailConfig.findOne({
      isActive: true,
      organizationId: job.organizationId,
    })
    if (!cfgDoc) {
      job.status = 'failed'
      job.lastError = 'Email configuration was removed before completion'
      job.completedAt = new Date()
      await job.save()
      await notifyJobFinished({
        organizationId: String(job.organizationId),
        jobId: String(job._id),
        status: 'failed',
        sent: job.sent ?? 0,
        failed: job.failed ?? 0,
        lastError: job.lastError,
        campaignId: payload.campaignId,
      })
      return NextResponse.json({ status: 'failed', error: job.lastError })
    }

    const decrypted = safeDecrypt(cfgDoc.password)
    if (!decrypted.ok) {
      job.status = 'failed'
      job.lastError = decryptFailureMessage(decrypted.reason)
      job.completedAt = new Date()
      await job.save()
      await notifyJobFinished({
        organizationId: String(job.organizationId),
        jobId: String(job._id),
        status: 'failed',
        sent: job.sent ?? 0,
        failed: job.failed ?? 0,
        lastError: job.lastError,
        campaignId: payload.campaignId,
      })
      return NextResponse.json({ status: 'failed', error: job.lastError })
    }

    const cfg = {
      email: cfgDoc.email,
      password: decrypted.value,
      fromName: sanitizeFromName(cfgDoc.fromName),
      replyTo: cfgDoc.replyTo?.trim() || undefined,
    }

    const claim = await EmailJob.findOneAndUpdate(
      { _id: job._id, status: { $ne: 'completed' } },
      [
        {
          $set: {
            pending: { $slice: ['$pending', BATCH_SIZE, { $size: '$pending' }] },
          },
        },
      ],
      { returnDocument: 'before' },
    )
    if (!claim) {
      return NextResponse.json({ status: job.status, done: true })
    }

    const pending: Types.ObjectId[] = (claim.pending as Types.ObjectId[]) ?? []
    const batch = pending.slice(0, BATCH_SIZE)
    const remaining = pending.slice(BATCH_SIZE)

    const transporter = createTransportWithFallback(cfg)
    const attachments = parseBulkAttachments(payload.attachments)

    const families = await Family.find({
      organizationId: job.organizationId,
      _id: { $in: batch },
    }).lean<any[]>()
    const byId = new Map(families.map((f) => [String(f._id), f]))

    let sentInBatch = 0
    let failedInBatch = 0
    const newErrors: { familyId: string; email: string | null; error: string }[] = []
    let processedCount = 0
    let quotaHit = false

    try {
      for (const familyId of batch) {
        const family = byId.get(familyId.toString())
        if (!family) {
          failedInBatch += 1
          if (job.errors.length + newErrors.length < 200) {
            newErrors.push({
              familyId: familyId.toString(),
              email: null,
              error: 'Family not found',
            })
          }
          processedCount += 1
          continue
        }

        const result = await sendBulkToFamily({
          organizationId: String(job.organizationId),
          userId: job.userId ? String(job.userId) : undefined,
          family,
          payload,
          attachments,
          emailJobId: String(job._id),
          transporter,
        })

        if (result.ok) sentInBatch += 1
        else {
          failedInBatch += 1
          const errMsg = result.error || 'Unknown error'
          if (job.errors.length + newErrors.length < 200) {
            newErrors.push({
              familyId: familyId.toString(),
              email: family.email || null,
              error: errMsg,
            })
          }
          if (isQuotaError(errMsg)) {
            quotaHit = true
            processedCount += 1
            break
          }
        }
        processedCount += 1
      }
    } catch (loopErr: unknown) {
      const unprocessed = batch.slice(processedCount)
      if (unprocessed.length > 0) {
        await EmailJob.updateOne(
          { _id: job._id },
          { $push: { pending: { $each: unprocessed, $position: 0 } } },
        ).catch(() => {})
      }
      if (processedCount > 0 || newErrors.length > 0) {
        const errorPushesOnFail = newErrors.map((e) => ({
          familyId: e.familyId,
          email: e.email || '',
          error: e.error,
        }))
        await EmailJob.updateOne(
          { _id: job._id },
          {
            $inc: { sent: sentInBatch, failed: failedInBatch, processed: processedCount },
            ...(errorPushesOnFail.length > 0 && {
              $push: { errors: { $each: errorPushesOnFail } },
            }),
            $set: {
              lastError:
                newErrors.length > 0
                  ? newErrors[newErrors.length - 1].error
                  : loopErr instanceof Error
                    ? loopErr.message
                    : String(loopErr),
            },
          },
        ).catch(() => {})
      }
      logError(loopErr, { module: 'communications.worker', jobId: String(job._id) })
      throw loopErr
    } finally {
      transporter.close?.()
    }

    const errorPushes = newErrors.map((e) => ({
      familyId: e.familyId,
      email: e.email || '',
      error: e.error,
    }))

    if (quotaHit) {
      const unprocessed = batch.slice(processedCount)
      const requeue = [...unprocessed, ...remaining]
      const quotaError =
        newErrors.length > 0 ? newErrors[newErrors.length - 1].error : 'Daily send quota exceeded'

      await EmailJob.updateOne(
        { _id: job._id },
        {
          $inc: { sent: sentInBatch, failed: failedInBatch, processed: processedCount },
          ...(errorPushes.length > 0 && { $push: { errors: { $each: errorPushes } } }),
          $set: {
            pending: requeue,
            status: 'failed',
            completedAt: new Date(),
            lastError: quotaError,
          },
        },
      )

      await notifyAdmins(String(job.organizationId), {
        kind: 'email.quota.exceeded',
        title: 'Daily email send quota reached',
        body: quotaError,
        link: '/communications',
        metadata: { jobId: String(job._id), campaignId: payload.campaignId },
      })
      await notifyJobFinished({
        organizationId: String(job.organizationId),
        jobId: String(job._id),
        status: 'failed',
        sent: (job.sent ?? 0) + sentInBatch,
        failed: (job.failed ?? 0) + failedInBatch,
        lastError: quotaError,
        campaignId: payload.campaignId,
      })

      return NextResponse.json({
        status: 'failed',
        error: quotaError,
        done: true,
      })
    }

    const hasMore = remaining.length > 0
    const set: Record<string, unknown> = {}
    if (newErrors.length > 0) {
      set.lastError = newErrors[newErrors.length - 1].error
    }
    if (!hasMore) {
      set.status = 'completed'
      set.completedAt = new Date()
    }

    await EmailJob.updateOne(
      { _id: job._id },
      {
        $inc: { sent: sentInBatch, failed: failedInBatch, processed: batch.length },
        ...(errorPushes.length > 0 && { $push: { errors: { $each: errorPushes } } }),
        ...(Object.keys(set).length > 0 && { $set: set }),
      },
    )

    if (!hasMore) {
      await notifyJobFinished({
        organizationId: String(job.organizationId),
        jobId: String(job._id),
        status: 'completed',
        sent: (job.sent ?? 0) + sentInBatch,
        failed: (job.failed ?? 0) + failedInBatch,
        lastError: newErrors.length > 0 ? newErrors[newErrors.length - 1].error : null,
        campaignId: payload.campaignId,
      })
    }

    if (hasMore) {
      const url = selfUrl(request, '/api/emails/send-bulk/worker')
      const secret = process.env.CRON_SECRET || ''
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const jobIdStr = job._id.toString()
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(secret ? { 'x-cron-secret': secret } : {}),
          cookie: request.headers.get('cookie') || '',
        },
        body: JSON.stringify({
          jobId: jobIdStr,
          organizationId: String(job.organizationId),
        }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            logError(new Error(`continuation HTTP ${res.status}: ${text.slice(0, 200)}`), {
              module: 'communications.worker',
              jobId: jobIdStr,
              phase: 'continuation',
            })
          }
        })
        .catch((err) => {
          logError(err, { module: 'communications.worker', jobId: jobIdStr, phase: 'continuation' })
        })
        .finally(() => clearTimeout(timer))
    }

    return NextResponse.json({
      status: hasMore ? 'running' : 'completed',
      processed: (job.processed ?? 0) + batch.length,
      sent: (job.sent ?? 0) + sentInBatch,
      failed: (job.failed ?? 0) + failedInBatch,
      remaining: remaining.length,
      done: !hasMore,
    })
  } catch (error: unknown) {
    console.error('[send-bulk worker] error:', error)
    return NextResponse.json(
      {
        error: 'Worker failed',
        ...(process.env.NODE_ENV !== 'production' && {
          details: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 },
    )
  }
}

export { POST as GET }
