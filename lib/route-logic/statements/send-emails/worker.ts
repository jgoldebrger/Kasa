/**
 * POST /api/statements/send-emails/worker
 *
 * Internal endpoint that processes one chunk of a queued EmailJob and
 * (if more work remains) triggers itself again. Two callers can reach it:
 *   - The kickoff POST /api/statements/send-emails (forwards the user's
 *     session cookie + CRON_SECRET header).
 *   - Internal self-recursion fires the same request with the same headers.
 *
 * Authenticated either by the active org session OR by the shared
 * CRON_SECRET header. Either way the job-owning organization is checked
 * against the supplied jobId.
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
import { sendOneFamilyStatement } from '@/lib/statements/send-statement'
import { selfUrl } from '@/lib/jobs'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'

// How many families one worker tick processes before handing off to the
// next tick. Small enough to fit under a 10s serverless budget but big
// enough that the per-batch HTTP overhead is rounding error.
const BATCH_SIZE = 5

export async function POST(request: NextRequest) {
  try {
    const csrfBlock = verifyApiCsrf(request)
    if (csrfBlock) return csrfBlock

    const rateVerdict = await checkRateLimit(request, 'statement-email-worker', {
      limit: 500,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    await connectDB()

    // Authn: either a logged-in org admin OR the cron secret. Either way
    // we ALWAYS verify the supplied jobId belongs to a known organization
    // context — for cron callers the orgId must be passed explicitly so
    // a leaked CRON_SECRET can't pivot to another tenant's email job.
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
    /* v8 ignore next 3 -- findOne already scopes by organizationId */
    if (!organizationId || String(job.organizationId) !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return NextResponse.json({ status: job.status, done: true })
    }

    // Lazily mark as running on the first tick.
    if (job.status === 'queued') {
      job.status = 'running'
      job.startedAt = job.startedAt || new Date()
      await job.save()
    }

    // Reload email config — credentials may have rotated since enqueue.
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

    // Atomically pop a batch from the pending list. Without this, two
    // overlapping worker ticks (Vercel retry, manual re-fire) would both
    // read the same `pending` array and re-process the same families,
    // duplicating SMTP sends. The Mongo update returns the doc BEFORE
    // the slice, then we pop the head ourselves and write the tail.
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

    // One pooled transporter per batch (Nodemailer reuses the SMTP socket).
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      pool: true,
      auth: { user: cfg.email, pass: cfg.password },
    })

    let sentInBatch = 0
    let failedInBatch = 0
    const newErrors: { familyId: string; email: string | null; error: string }[] = []
    // Track the slice we've actually finished so a synchronous throw
    // out of the loop (Mongo blip, SMTP socket error, etc.) doesn't
    // silently lose the rest of the claimed batch. The atomic claim
    // above already removed them from `pending`, so without this
    // recovery path they'd never be emailed.
    let processedCount = 0

    try {
      for (const familyId of batch) {
        const result = await sendOneFamilyStatement({
          organizationId: String(job.organizationId),
          familyId: familyId.toString(),
          fromDate: job.fromDate as Date,
          toDate: job.toDate as Date,
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
      // Push the unprocessed tail of the claim back onto `pending` so a
      // follow-up tick (or worker restart) can retry them. We rely on
      // the atomic claim above being the only thing that removed them.
      const unprocessed = batch.slice(processedCount)
      if (unprocessed.length > 0) {
        await EmailJob.updateOne(
          { _id: job._id },
          { $push: { pending: { $each: unprocessed, $position: 0 } } },
        ).catch(() => {})
      }

      // Commit the partial progress before re-throwing. Without this
      // path, families we ALREADY processed in this batch (their
      // emails were sent, or their failures captured into newErrors)
      // are claimed-and-forgotten: `pending` no longer contains them,
      // `processed/sent/failed/errors` were never incremented, so the
      // progress UI undercounts and the per-family error reasons are
      // silently dropped. Same atomic `$inc` shape as the happy path
      // so concurrent worker writes still compose.
      if (processedCount > 0 || newErrors.length > 0) {
        const errorPushesOnFail = newErrors.map((e) => ({
          familyId: e.familyId,
          email: e.email || '',
          error: e.error,
        }))
        const setOnFail: Record<string, unknown> = {
          lastError:
            newErrors.length > 0
              ? newErrors[newErrors.length - 1].error
              : loopErr?.message || String(loopErr),
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
        module: 'statements.worker',
        jobId: String(job._id),
        unrecovered: unprocessed.length,
        committedProcessed: processedCount,
        committedSent: sentInBatch,
        committedFailed: failedInBatch,
      })
      throw loopErr
    } finally {
      transporter.close()
    }

    // Re-load the doc so we keep the atomic `pending` value the slice
    // pipeline wrote, then update progress counters via $inc to avoid
    // clobbering concurrent worker writes.
    const errorPushes = newErrors.map((e) => ({
      familyId: e.familyId,
      email: e.email || '',
      error: e.error,
    }))
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
      // Fire the next tick. Don't await — we want the current invocation to
      // return quickly so it doesn't hold a serverless slot. Always pass
      // organizationId in the body so a cron-authenticated retry can
      // validate ownership without leaking across tenants.
      //
      // Continuation failures are LOGGED (was: silently swallowed). A
      // 401 here (e.g. session cookie expired mid-job, missing
      // CRON_SECRET) used to leave the EmailJob stuck in `running`
      // forever; surfacing the error makes operator triage possible.
      const url = selfUrl(request, '/api/statements/send-emails/worker')
      const secret = process.env.CRON_SECRET || ''
      if (!secret) {
        // No CRON_SECRET configured — continuation must lean on the
        // user's session cookie. For short jobs that's fine, but a
        // multi-hour job started near session expiry will lose
        // auth on the next tick. Log it loudly so the operator can
        // set CRON_SECRET before this bites in production.
        logError(new Error('CRON_SECRET is not set; long EmailJob runs risk losing auth on continuation'), {
          module: 'statements.worker',
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
              module: 'statements.worker',
              jobId: jobIdStr,
              phase: 'continuation',
            })
          }
        })
        .catch((err) => {
          logError(err, {
            module: 'statements.worker',
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
    console.error('[send-emails worker] error:', error)
    return NextResponse.json(
      {
        error: 'Worker failed',
        ...(process.env.NODE_ENV !== 'production' && { details: error?.message }),
      },
      { status: 500 },
    )
  }
}
