import { Types } from 'mongoose'
import type { NextRequest } from 'next/server'
import type nodemailer from 'nodemailer'
import { Family, EmailJob, EmailConfig } from '@/lib/models'
import {
  sendEmail,
  applyMergeFields,
  loadMergeFieldContext,
  delayBetweenSendsMs,
  sleep,
} from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { checkRateLimit } from '@/lib/rate-limit'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { audit } from '@/lib/audit'
import { findActiveEmailJob, sweepStaleEmailJobs, kickoffEmailWorker } from '@/lib/email-jobs'

const ASYNC_FAMILY_THRESHOLD = 20

export interface BulkEmailPayload {
  subject: string
  subjectB?: string
  html: string
  text?: string
  transactional?: boolean
  attachments?: { filename: string; contentBase64: string; contentType?: string }[]
  campaignId: string
}

export function parseBulkAttachments(
  attachments?: { filename: string; contentBase64: string; contentType?: string }[],
) {
  return attachments?.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.contentBase64, 'base64'),
    contentType: a.contentType,
  }))
}

export function pickBulkSubject(
  payload: Pick<BulkEmailPayload, 'subject' | 'subjectB'>,
  familyId: string,
): string {
  if (!payload.subjectB?.trim()) return payload.subject
  // Stable per-family A/B assignment from family id hash.
  const hash = familyId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return hash % 2 === 0 ? payload.subject : payload.subjectB
}

export async function sendBulkToFamily(opts: {
  organizationId: string
  userId?: string
  family: { _id: unknown; name?: string; email?: string; communicationsOptOut?: boolean }
  payload: BulkEmailPayload
  attachments?: ReturnType<typeof parseBulkAttachments>
  emailJobId?: string
  auditRequest?: Request
  transporter?: nodemailer.Transporter
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const familyId = String(opts.family._id)
  if (!opts.payload.transactional && opts.family.communicationsOptOut) {
    return { ok: false, error: 'opted out' }
  }
  if (!opts.family.email) {
    return { ok: false, error: 'no email on file' }
  }

  const mergeCtx = await loadMergeFieldContext(familyId, opts.organizationId)
  const html = applyMergeFields(opts.payload.html, mergeCtx).replace(
    /\{\{familyName\}\}/g,
    escapeHtml(opts.family.name || ''),
  )
  const text = opts.payload.text
    ? applyMergeFields(opts.payload.text, mergeCtx).replace(
        /\{\{familyName\}\}/g,
        opts.family.name || '',
      )
    : undefined

  const result = await sendEmail({
    organizationId: opts.organizationId,
    userId: opts.userId,
    familyId,
    to: opts.family.email,
    subject: pickBulkSubject(opts.payload, familyId),
    html,
    text,
    attachments: opts.attachments,
    kind: 'custom',
    campaignId: opts.payload.campaignId,
    emailJobId: opts.emailJobId,
    tracking: { opens: true, clicks: true },
    auditRequest: opts.auditRequest,
    transporter: opts.transporter,
  })

  if (result.ok) return { ok: true }
  return { ok: false, error: result.error || 'send failed' }
}

async function enqueueBulkJob(opts: {
  organizationId: string
  userId: string
  familyIds: string[]
  payload: BulkEmailPayload
  request: NextRequest
}) {
  await sweepStaleEmailJobs({ organizationId: opts.organizationId, kind: 'communications' })

  const activeJob = await findActiveEmailJob({
    organizationId: opts.organizationId,
    kind: 'communications',
  })
  if (activeJob) {
    return {
      status: 409 as const,
      data: {
        error: 'A communications email job is already in progress.',
        jobId: String(activeJob._id),
        status: activeJob.status,
      },
    }
  }

  const emailConfigDoc = await EmailConfig.findOne({
    isActive: true,
    organizationId: opts.organizationId,
  })
  if (!emailConfigDoc) {
    return {
      status: 400 as const,
      data: { error: 'Email configuration not found. Please configure email settings first.' },
    }
  }

  const job = await EmailJob.create({
    organizationId: opts.organizationId,
    userId: opts.userId,
    kind: 'communications',
    status: 'queued',
    totalFamilies: opts.familyIds.length,
    pending: opts.familyIds.map((id) => new Types.ObjectId(id)),
    payload: opts.payload,
    startedAt: new Date(),
  })

  await audit({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: 'communications.bulk_enqueue',
    resourceType: 'EmailJob',
    resourceId: job._id,
    metadata: {
      familyCount: opts.familyIds.length,
      campaignId: opts.payload.campaignId,
      subject: opts.payload.subject,
    },
    request: opts.request,
  })

  const kickoff = await kickoffEmailWorker({
    request: opts.request,
    workerPath: '/api/emails/send-bulk/worker',
    jobId: job._id.toString(),
    organizationId: opts.organizationId,
    body: { jobId: job._id.toString(), organizationId: opts.organizationId },
  })
  if (!kickoff.ok) {
    return {
      status: 500 as const,
      data: { error: 'Failed to start email worker', jobId: job._id.toString() },
    }
  }

  return {
    status: 202 as const,
    data: {
      jobId: job._id.toString(),
      totalFamilies: opts.familyIds.length,
      status: 'queued',
      campaignId: opts.payload.campaignId,
    },
  }
}

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailSchemas.sendBulkEmailBody,
  query: emailSchemas.sendBulkEmailQuery,
  name: 'POST /api/emails/send-bulk',
  fn: async ({ ctx, body, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-send-bulk',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const campaignId = new Types.ObjectId()
    const payload: BulkEmailPayload = {
      subject: body.subject,
      subjectB: body.subjectB,
      html: body.html,
      text: body.text,
      transactional: body.transactional,
      attachments: body.attachments,
      campaignId: String(campaignId),
    }

    const useAsync = query?.async === true || body.familyIds.length > ASYNC_FAMILY_THRESHOLD
    if (useAsync) {
      return enqueueBulkJob({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        familyIds: body.familyIds,
        payload,
        request: request as NextRequest,
      })
    }

    const families = await Family.find({
      organizationId: ctx!.organizationId,
      _id: { $in: body.familyIds },
    }).lean<any[]>()

    const byId = new Map(families.map((f) => [String(f._id), f]))
    const results = { sent: 0, failed: 0, errors: [] as string[] }
    const pacingMs = delayBetweenSendsMs(body.familyIds.length)
    const attachments = parseBulkAttachments(body.attachments)
    let sendIndex = 0

    for (const id of body.familyIds) {
      if (sendIndex > 0 && pacingMs > 0) {
        await sleep(pacingMs)
      }
      sendIndex++

      const family = byId.get(id)
      if (!family) {
        results.failed++
        results.errors.push(`Family ${id}: not found`)
        continue
      }

      const result = await sendBulkToFamily({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        family,
        payload,
        attachments,
        auditRequest: request,
      })

      if (result.ok) results.sent++
      else {
        results.failed++
        results.errors.push(`${family.name}: ${result.error}`)
      }
    }

    return { data: { ...results, campaignId: String(campaignId) } }
  },
})
