/**
 * POST /api/tax-receipts/email/worker
 *
 * Background worker that processes one chunk of a queued tax-receipt
 * EmailJob and (if more work remains) triggers itself again. Same
 * shape as the statements worker — see
 * `app/api/statements/send-emails/worker/route.ts` for the why.
 *
 * Authenticated by an org session OR the CRON_SECRET header. The job's
 * organizationId is checked against the supplied jobId in either case.
 *
 * Body: { jobId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyApiCsrf } from '@/lib/csrf'
import { Types } from 'mongoose'
import connectDB from '@/lib/database'
import { requireOrg } from '@/lib/auth-helpers'
import { isCronRequest } from '@/lib/auth-cron'
import { EmailJob, EmailConfig } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { sanitizeFromName } from '@/lib/email-from-name'
import { sendOneFamilyTaxReceipt } from '@/lib/tax-receipts/send-receipt'
import { selfUrl } from '@/lib/jobs'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'

// Receipts include a fresh PDF render per family — keep the batch
// smaller than the statements worker so we stay safely under 10s.
const BATCH_SIZE = 3

export async function POST(request: NextRequest) {
  try {
    const csrfBlock = verifyApiCsrf(request)
    if (csrfBlock) return csrfBlock

    const rateVerdict = await checkRateLimit(request, 'tax-receipt-email-worker', {
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
      const orgFromBody = (body as any)?.organizationId
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

    const job = await EmailJob.findOne({ _id: jobId, organizationId })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (job.kind !== 'tax-receipts') {
      return NextResponse.json({ error: 'Wrong worker for this job kind' }, { status: 400 })
    }
    /* v8 ignore next 3 -- findOne already scopes by organizationId */
    if (!organizationId || String(job.organizationId) !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return NextResponse.json({ status: job.status, done: true })
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
      return NextResponse.json({ status: 'failed', error: job.lastError })
    }

    const decrypted = safeDecrypt(cfgDoc.password)
    if (!decrypted.ok) {
      job.status = 'failed'
      job.lastError = decryptFailureMessage(decrypted.reason)
      job.completedAt = new Date()
      await job.save()
      return NextResponse.json({ status: 'failed', error: job.lastError })
    }

    const cfg = {
      email: cfgDoc.email,
      password: decrypted.value,
      fromName: sanitizeFromName(cfgDoc.fromName),
    }

    // Atomic claim: pop the head of `pending` and write back the tail in
    // a single Mongo update so two overlapping worker invocations can't
    // process the same family twice.
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

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      pool: true,
      auth: { user: cfg.email, pass: cfg.password },
    })

    let sentInBatch = 0
    let failedInBatch = 0
    const newErrors: { familyId: string; email: string | null; error: string }[] = []
    // Track how far we got so a synchronous throw out of the loop
    // doesn't lose the rest of the claimed batch. See statements worker
    // for the recovery-path rationale.
    let processedCount = 0

    try {
      for (const familyId of batch) {
        const result = await sendOneFamilyTaxReceipt({
          organizationId: String(job.organizationId),
          familyId: familyId.toString(),
          year: Number(job.year),
          config: cfg,
          transporter,
        })
        if (result.ok) {
          sentInBatch += 1
        } else {
          failedInBatch += 1
          if (job.errors.length + newErrors.length < 200) {
            newErrors.push({
              familyId: familyId.toString(),
              email: result.email,
              error: result.error || 'Unknown error',
            })
          }
        }
        processedCount += 1
      }
    } catch (loopErr: any) {
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
          error: sanitizeStripeErrorMessage(e.error),
        }))
        const setOnFail: Record<string, unknown> = {
          lastError:
            newErrors.length > 0
              ? sanitizeStripeErrorMessage(newErrors[newErrors.length - 1].error)
              : sanitizeStripeErrorMessage(loopErr?.message || String(loopErr)),
        }
        await EmailJob.updateOne(
          { _id: job._id },
          {
            $inc: {
              sent: sentInBatch,
              failed: failedInBatch,
              processed: processedCount,
            },
            ...(errorPushesOnFail.length > 0 && {
              $push: { errors: { $each: errorPushesOnFail } },
            }),
            $set: setOnFail,
          },
        ).catch(() => {})
      }

      logError(loopErr, {
        module: 'tax-receipts.worker',
        jobId: String(job._id),
        unrecovered: unprocessed.length,
      })
      throw loopErr
    } finally {
      transporter.close()
    }

    const errorPushes = newErrors.map((e) => ({
      familyId: e.familyId,
      email: e.email || '',
      error: sanitizeStripeErrorMessage(e.error),
    }))
    const hasMore = remaining.length > 0
    const set: Record<string, unknown> = {}
    if (newErrors.length > 0) {
      set.lastError = sanitizeStripeErrorMessage(newErrors[newErrors.length - 1].error)
    }
    if (!hasMore) {
      set.status = 'completed'
      set.completedAt = new Date()
    }

    await EmailJob.updateOne(
      { _id: job._id },
      {
        $inc: {
          sent: sentInBatch,
          failed: failedInBatch,
          processed: batch.length,
        },
        ...(errorPushes.length > 0 && { $push: { errors: { $each: errorPushes } } }),
        ...(Object.keys(set).length > 0 && { $set: set }),
      },
    )

    if (hasMore) {
      // Continuation failures are LOGGED — silent swallowing previously
      // left jobs stuck in `running` forever when the auth context
      // expired mid-job.
      const url = selfUrl(request, '/api/tax-receipts/email/worker')
      const secret = process.env.CRON_SECRET || ''
      if (!secret) {
        logError(new Error('CRON_SECRET is not set; long tax-receipt EmailJob runs risk losing auth on continuation'), {
          module: 'tax-receipts.worker',
          jobId: job._id.toString(),
          phase: 'continuation-auth',
          level: 'warn',
        })
      }
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
              module: 'tax-receipts.worker',
              jobId: jobIdStr,
              phase: 'continuation',
            })
          }
        })
        .catch((err) => {
          logError(err, {
            module: 'tax-receipts.worker',
            jobId: jobIdStr,
            phase: 'continuation',
          })
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
  } catch (error: any) {
    console.error('[tax-receipts worker] error:', error)
    return NextResponse.json(
      {
        error: 'Worker failed',
        ...(process.env.NODE_ENV !== 'production' && { details: error?.message }),
      },
      { status: 500 },
    )
  }
}
