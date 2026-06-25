import { Types } from 'mongoose'
import type nodemailer from 'nodemailer'
import { EmailMessage } from '@/lib/models'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/log'
import { isAllowedOutboundRecipient } from '@/lib/email-recipients'
import { createGmailTransport } from './create-transport'
import { applyEmailTracking } from './tracking-html'
import { loadOrgEmailConfig, type OrgEmailConfigCreds } from './load-org-email-config'

export type EmailKind = 'custom' | 'statement' | 'tax-receipt' | 'task-reminder' | 'file'

export interface SendEmailAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface SendEmailInput {
  organizationId: string
  familyId?: string | null
  userId?: string | null
  to: string
  subject: string
  html?: string
  text?: string
  attachments?: SendEmailAttachment[]
  kind: EmailKind
  relatedResource?: { type: string; id: string }
  emailJobId?: string
  tracking?: { opens?: boolean; clicks?: boolean }
  transporter?: nodemailer.Transporter
  config?: OrgEmailConfigCreds
  auditRequest?: Request
}

export interface SendEmailResult {
  ok: boolean
  emailMessageId?: string
  error?: string
}

function appBaseUrl(): string {
  const url = process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'http://localhost:3000'
  return url.replace(/\/$/, '')
}

async function recordFailedEmail(
  input: SendEmailInput,
  to: string,
  subject: string,
  error: string,
): Promise<SendEmailResult> {
  const doc = await EmailMessage.create({
    organizationId: new Types.ObjectId(input.organizationId),
    familyId: input.familyId ? new Types.ObjectId(input.familyId) : undefined,
    userId: input.userId ? new Types.ObjectId(input.userId) : undefined,
    to,
    subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 998),
    kind: input.kind,
    provider: 'gmail',
    status: 'failed',
    error,
    events: [
      { type: 'queued', at: new Date() },
      { type: 'failed', at: new Date(), meta: { message: error } },
    ],
  })
  logError(new Error(error), {
    module: 'mail.sendEmail',
    organizationId: input.organizationId,
    kind: input.kind,
    familyId: input.familyId ?? undefined,
  })
  if (input.auditRequest) {
    void audit({
      organizationId: input.organizationId,
      userId: input.userId ?? undefined,
      action: 'email.failed',
      resourceType: 'EmailMessage',
      resourceId: doc._id,
      metadata: { kind: input.kind, familyId: input.familyId ?? null, reason: error },
      request: input.auditRequest,
    })
  }
  return { ok: false, emailMessageId: String(doc._id), error }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.trim()
  const subject = input.subject.replace(/[\r\n]+/g, ' ').slice(0, 998)
  if (!to) return { ok: false, error: 'Recipient email is required' }

  const allowed = await isAllowedOutboundRecipient(input.organizationId, to)
  if (!allowed) {
    return recordFailedEmail(
      input,
      to,
      subject,
      'Recipient must be an organization member or a family contact email on file in this organization.',
    )
  }

  const credsResult = input.config
    ? ({ ok: true as const, config: input.config } satisfies {
        ok: true
        config: OrgEmailConfigCreds
      })
    : await loadOrgEmailConfig(input.organizationId)
  if (!credsResult.ok) {
    return recordFailedEmail(input, to, subject, credsResult.error)
  }
  const creds = credsResult.config

  const trackOpens =
    input.tracking?.opens ?? (input.kind === 'custom' || input.kind === 'task-reminder')
  const trackClicks =
    input.tracking?.clicks ?? (input.kind === 'custom' || input.kind === 'task-reminder')
  const hasHtml = Boolean(input.html?.trim())

  const doc = await EmailMessage.create({
    organizationId: new Types.ObjectId(input.organizationId),
    familyId: input.familyId ? new Types.ObjectId(input.familyId) : undefined,
    userId: input.userId ? new Types.ObjectId(input.userId) : undefined,
    emailJobId: input.emailJobId ? new Types.ObjectId(input.emailJobId) : undefined,
    to,
    subject,
    kind: input.kind,
    provider: 'gmail',
    status: 'queued',
    relatedResource: input.relatedResource,
    openTracking: trackOpens && hasHtml,
    clickTracking: trackClicks && hasHtml,
    events: [{ type: 'queued', at: new Date() }],
  })

  const emailMessageId = String(doc._id)

  try {
    let html = input.html
    if (html && (trackOpens || trackClicks)) {
      html = applyEmailTracking(html, {
        emailMessageId,
        baseUrl: appBaseUrl(),
        trackOpens: trackOpens,
        trackClicks: trackClicks,
      })
    }

    const transporter = input.transporter ?? createGmailTransport(creds)
    await transporter.sendMail({
      from: `"${creds.fromName}" <${creds.email}>`,
      to,
      subject: doc.subject,
      text: input.text,
      html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    })

    await EmailMessage.updateOne(
      { _id: doc._id },
      {
        $set: { status: 'sent' },
        $push: { events: { type: 'sent', at: new Date() } },
      },
    )

    if (input.auditRequest) {
      void audit({
        organizationId: input.organizationId,
        userId: input.userId ?? undefined,
        action: 'email.sent',
        resourceType: 'EmailMessage',
        resourceId: doc._id,
        metadata: { kind: input.kind, familyId: input.familyId ?? null },
        request: input.auditRequest,
      })
    }

    return { ok: true, emailMessageId }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logError(err, {
      module: 'mail.sendEmail',
      organizationId: input.organizationId,
      kind: input.kind,
      familyId: input.familyId ?? undefined,
      emailMessageId,
    })
    await EmailMessage.updateOne(
      { _id: doc._id },
      {
        $set: { status: 'failed', error: message },
        $push: { events: { type: 'failed', at: new Date(), meta: { message } } },
      },
    )

    if (input.auditRequest) {
      void audit({
        organizationId: input.organizationId,
        userId: input.userId ?? undefined,
        action: 'email.failed',
        resourceType: 'EmailMessage',
        resourceId: doc._id,
        metadata: { kind: input.kind, familyId: input.familyId ?? null },
        request: input.auditRequest,
      })
    }

    return { ok: false, emailMessageId, error: message }
  }
}
