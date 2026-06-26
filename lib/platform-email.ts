import nodemailer from 'nodemailer'
import { escapeHtml } from '@/lib/html-escape'
import { normalizeGmailAppPassword } from '@/lib/mail/normalize-app-password'
import { createTransportWithFallback, normalizeTransportCreds } from '@/lib/mail/create-transport'
import { formatMailError } from '@/lib/mail/format-mail-error'

function getPlatformAdminEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Platform-level email sender. Used for messages that don't belong to a
 * single tenant (e.g. invitation approvals). Falls back gracefully if the
 * env config is missing — callers can show the message inline to the admin.
 *
 * Required env vars to enable sending:
 *   PLATFORM_SMTP_HOST   - e.g. smtp.gmail.com
 *   PLATFORM_SMTP_PORT   - e.g. 465 or 587
 *   PLATFORM_SMTP_USER   - SMTP username
 *   PLATFORM_SMTP_PASS   - SMTP password / app password
 *   PLATFORM_SMTP_FROM   - "Name <from@example.com>"
 *   PLATFORM_SMTP_SECURE - "true" for 465, "false" for 587 (default true)
 */

export interface PlatformEmail {
  to: string
  subject: string
  html?: string
  text?: string
}

export interface SendResult {
  sent: boolean
  reason?: string
  error?: string
}

export function isPlatformEmailConfigured(): boolean {
  return Boolean(
    process.env.PLATFORM_SMTP_HOST?.trim() &&
    process.env.PLATFORM_SMTP_PORT?.trim() &&
    process.env.PLATFORM_SMTP_USER?.trim() &&
    process.env.PLATFORM_SMTP_PASS?.trim() &&
    process.env.PLATFORM_SMTP_FROM?.trim(),
  )
}

function createPlatformTransport(): nodemailer.Transporter {
  const host = process.env.PLATFORM_SMTP_HOST!.trim().toLowerCase()
  const user = process.env.PLATFORM_SMTP_USER!.trim()
  const pass = process.env.PLATFORM_SMTP_PASS!

  if (host === 'smtp.gmail.com') {
    return createTransportWithFallback({ email: user, password: pass })
  }

  const port = parseInt(process.env.PLATFORM_SMTP_PORT!, 10)
  const secure = process.env.PLATFORM_SMTP_SECURE !== 'false'
  const normalized = normalizeTransportCreds({ email: user, password: pass })

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: normalized.email, pass: normalized.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
}

export async function sendPlatformEmail(msg: PlatformEmail): Promise<SendResult> {
  if (!isPlatformEmailConfigured()) {
    return { sent: false, reason: 'platform SMTP not configured' }
  }

  try {
    const port = parseInt(process.env.PLATFORM_SMTP_PORT!, 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return { sent: false, reason: 'invalid PLATFORM_SMTP_PORT' }
    }

    const transporter = createPlatformTransport()

    await transporter.sendMail({
      from: process.env.PLATFORM_SMTP_FROM!,
      to: msg.to,
      // Strip header-injection vectors
      subject: msg.subject.replace(/[\r\n]+/g, ' ').slice(0, 998),
      text: msg.text,
      html: msg.html,
    })

    return { sent: true }
  } catch (err: unknown) {
    const message = formatMailError(err)
    console.error('[platform-email] send failed:', message)
    return { sent: false, error: message }
  }
}

export interface InviteRequestAdminNotification {
  name: string
  email: string
  orgName?: string
}

/**
 * Email every platform admin when a visitor submits a new signup request.
 * No-ops with a warning when SMTP or admin emails are not configured.
 */
export async function notifyPlatformAdminsOfInviteRequest(
  input: InviteRequestAdminNotification,
): Promise<void> {
  const admins = getPlatformAdminEmails()
  if (admins.length === 0) {
    console.warn(
      '[request-invite] PLATFORM_ADMIN_EMAILS not configured; admin notification not sent.',
    )
    return
  }

  if (!isPlatformEmailConfigured()) {
    console.warn('[request-invite] Platform SMTP not configured; admin notification not sent.')
    return
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const adminUrl = `${baseUrl}/admin/invite-requests`
  const safeName = escapeHtml(input.name)
  const safeEmail = escapeHtml(input.email)
  const orgText = input.orgName ? `\nOrganization: ${input.orgName}\n` : '\n'
  const orgHtml = input.orgName
    ? `<p><strong>Organization:</strong> ${escapeHtml(input.orgName)}</p>`
    : ''

  const subject = `New Kasa signup request from ${input.name.replace(/[\r\n]+/g, ' ').slice(0, 200)}`

  for (const to of admins) {
    const result = await sendPlatformEmail({
      to,
      subject,
      text:
        `A new signup request was submitted.\n\n` +
        `Name: ${input.name}\n` +
        `Email: ${input.email}` +
        orgText +
        `\nReview pending requests:\n${adminUrl}\n`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; line-height: 1.6; color: #222;">
          <h2 style="margin: 0 0 12px;">New signup request</h2>
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          ${orgHtml}
          <p style="margin: 20px 0;">
            <a href="${escapeHtml(adminUrl)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Review invite requests</a>
          </p>
          <p style="color:#555;font-size:13px;word-break:break-all;">Or open: ${escapeHtml(adminUrl)}</p>
        </div>
      `,
    })
    if (!result.sent) {
      console.error(
        `[request-invite] admin notification to ${to} failed:`,
        result.reason || result.error,
      )
    }
  }
}

export interface InviteRequestRejectionEmail {
  to: string
  name: string
  rejectReason?: string
}

/**
 * Notify a visitor that their signup request was rejected.
 */
export async function sendInviteRequestRejectionEmail(
  input: InviteRequestRejectionEmail,
): Promise<SendResult> {
  if (!isPlatformEmailConfigured()) {
    return { sent: false, reason: 'platform SMTP not configured' }
  }

  const reasonBlock = input.rejectReason?.trim()
  const reasonText = reasonBlock ? `\n\nReason: ${reasonBlock}\n` : ''
  const reasonHtml = reasonBlock ? `<p><strong>Reason:</strong> ${escapeHtml(reasonBlock)}</p>` : ''

  return sendPlatformEmail({
    to: input.to,
    subject: 'Update on your Kasa invitation request',
    text:
      `Hi ${input.name},\n\n` +
      `Thank you for your interest in Kasa. After reviewing your request, we're unable to approve access at this time.${reasonText}\n` +
      `If you believe this was a mistake, you can reply to this email or submit a new request later.\n`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; line-height: 1.6; color: #222;">
        <h2 style="margin: 0 0 12px;">Update on your invitation request</h2>
        <p>Hi ${escapeHtml(input.name)},</p>
        <p>Thank you for your interest in Kasa. After reviewing your request, we're unable to approve access at this time.</p>
        ${reasonHtml}
        <p style="color:#888;font-size:12px;margin-top:30px;">If you believe this was a mistake, you can reply to this email or submit a new request later.</p>
      </div>
    `,
  })
}
