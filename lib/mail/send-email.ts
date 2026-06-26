import { Types } from 'mongoose'
import type nodemailer from 'nodemailer'
import { EmailMessage, Organization, Family } from '@/lib/models'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/log'
import { isAllowedOutboundRecipient } from '@/lib/email-recipients'
import { createTransportWithFallback } from './create-transport'
import { applyEmailTracking } from './tracking-html'
import { loadOrgEmailConfig, type OrgEmailConfigCreds } from './load-org-email-config'
import { notifyAdmins } from '@/lib/notify'
import { wrapEmailHtml, type OrgPhysicalAddress } from './email-wrapper'
import { buildUnsubscribeUrl, createUnsubscribeToken } from './unsubscribe-token'
import { checkDailySendQuota } from './daily-send-quota'

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
  campaignId?: string
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

function bodyPreviewFrom(html?: string, text?: string): string | undefined {
  const raw = (
    text?.trim() ||
    html
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ||
    ''
  ).slice(0, 200)
  return raw || undefined
}

async function trackDeliverabilityFailure(organizationId: string, to: string): Promise<void> {
  const normalized = to.trim().toLowerCase()
  if (!normalized) return
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const failureCount = await EmailMessage.countDocuments({
    organizationId: new Types.ObjectId(organizationId),
    to: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    status: 'failed',
    createdAt: { $gte: sevenDaysAgo },
  })
  if (failureCount >= 3) {
    await Family.updateMany(
      {
        organizationId: new Types.ObjectId(organizationId),
        email: {
          $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        },
      },
      { $set: { emailDeliverabilityWarning: true } },
    )
  }
}

async function loadOrgBranding(organizationId: string): Promise<{
  orgName: string
  logoDataUrl: string | null
  physicalAddress: OrgPhysicalAddress | null
}> {
  const org = await Organization.findById(organizationId)
    .select('name branding.logoDataUrl letterhead')
    .lean<{
      name?: string
      branding?: { logoDataUrl?: string }
      letterhead?: OrgPhysicalAddress
    }>()
  const letterhead = org?.letterhead
  const physicalAddress =
    letterhead &&
    (letterhead.addressLine1?.trim() ||
      letterhead.addressLine2?.trim() ||
      letterhead.city?.trim() ||
      letterhead.state?.trim() ||
      letterhead.zip?.trim())
      ? {
          addressLine1: letterhead.addressLine1,
          addressLine2: letterhead.addressLine2,
          city: letterhead.city,
          state: letterhead.state,
          zip: letterhead.zip,
        }
      : null
  return {
    orgName: org?.name || 'Kasa Family Management',
    logoDataUrl: org?.branding?.logoDataUrl || null,
    physicalAddress,
  }
}

async function prepareCustomHtml(
  input: SendEmailInput,
  trackOpens: boolean,
  trackClicks: boolean,
): Promise<string | undefined> {
  if (!input.html?.trim()) return input.html

  const trackingEnabled = trackOpens || trackClicks
  if (input.kind !== 'custom' || !trackingEnabled) return input.html

  const branding = await loadOrgBranding(input.organizationId)
  let unsubscribeUrl: string | null = null
  if (input.familyId) {
    const token = createUnsubscribeToken(input.organizationId, input.familyId)
    unsubscribeUrl = buildUnsubscribeUrl(appBaseUrl(), token)
  }

  return wrapEmailHtml(input.html, {
    orgName: branding.orgName,
    logoDataUrl: branding.logoDataUrl,
    unsubscribeUrl,
    physicalAddress: branding.physicalAddress,
  })
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
    campaignId: input.campaignId ? new Types.ObjectId(input.campaignId) : undefined,
    to,
    subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 998),
    bodyPreview: bodyPreviewFrom(input.html, input.text),
    html: input.html,
    text: input.text,
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
  void trackDeliverabilityFailure(input.organizationId, to)
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

  const quota = await checkDailySendQuota(input.organizationId)
  if (!quota.ok) {
    return recordFailedEmail(input, to, subject, quota.error)
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
    campaignId: input.campaignId ? new Types.ObjectId(input.campaignId) : undefined,
    to,
    subject,
    bodyPreview: bodyPreviewFrom(input.html, input.text),
    html: input.html,
    text: input.text,
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
    let html = await prepareCustomHtml(input, trackOpens, trackClicks)
    if (html && (trackOpens || trackClicks)) {
      html = applyEmailTracking(html, {
        emailMessageId,
        baseUrl: appBaseUrl(),
        trackOpens: trackOpens,
        trackClicks: trackClicks,
      })
    }

    const transporter = input.transporter ?? createTransportWithFallback(creds)
    await transporter.sendMail({
      from: `"${creds.fromName}" <${creds.email}>`,
      to,
      subject: doc.subject,
      text: input.text,
      html,
      ...(creds.replyTo ? { replyTo: creds.replyTo } : {}),
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

    if (input.kind === 'custom' || input.kind === 'statement' || input.kind === 'tax-receipt') {
      void notifyAdmins(input.organizationId, {
        kind: 'email.sent',
        title: `Email sent (${input.kind})`,
        body: `${subject} — ${to}`,
        link: input.familyId ? `/families/${input.familyId}` : '',
        metadata: { kind: input.kind, familyId: input.familyId ?? null, to },
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

    void trackDeliverabilityFailure(input.organizationId, to)

    return { ok: false, emailMessageId, error: message }
  }
}
