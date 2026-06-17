import { EmailConfig } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { escapeHtml } from '@/lib/html-escape'
import { sanitizeFromName } from '@/lib/email-from-name'
import { isAllowedOutboundRecipient } from '@/lib/email-recipients'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import nodemailer from 'nodemailer'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SAFE_MIME_PREFIXES = [
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]
function isSafeMime(mime: string | undefined | null): boolean {
  if (!mime) return false
  const m = mime.toLowerCase()
  return SAFE_MIME_PREFIXES.some((p) => m === p || m.startsWith(p + ';'))
}

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'POST /api/send-file-email',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'send-file-email',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_BYTES) {
      return { status: 413, data: { error: 'Attachment exceeds 10 MB limit' } }
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return { status: 413, data: { error: 'Attachment exceeds 10 MB limit' } }
    }
    const file = formData.get('file') as File
    const to = ((formData.get('to') as string) || '').trim()
    const rawSubject = (formData.get('subject') as string) || 'File from Kasa Family Management'
    const rawMessage = (formData.get('message') as string) || 'Please find the attached file.'
    const subject = rawSubject.replace(/[\r\n]+/g, ' ').slice(0, 998)
    const message = rawMessage.slice(0, 10_000)

    if (!file) {
      return { status: 400, data: { error: 'File is required' } }
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { status: 413, data: { error: 'Attachment exceeds 10 MB limit' } }
    }

    if (!isSafeMime(file.type)) {
      return {
        status: 415,
        data: {
          error:
            `Attachment type "${file.type || 'unknown'}" is not allowed. ` +
            `Supported types: PDF, CSV, Excel, Word, ZIP, common images.`,
        },
      }
    }

    if (!to || !EMAIL_RE.test(to)) {
      return { status: 400, data: { error: 'Valid recipient email address is required' } }
    }

    const recipientAllowed = await isAllowedOutboundRecipient(ctx!.organizationId, to)
    if (!recipientAllowed) {
      return {
        status: 400,
        data: {
          error:
            'Recipient must be an organization member or a family contact email on file in this organization.',
        },
      }
    }

    const emailConfigDoc = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    if (!emailConfigDoc) {
      return {
        status: 400,
        data: { error: 'Email configuration not found. Please configure email settings first.' },
      }
    }

    const decrypted = safeDecrypt(emailConfigDoc.password)
    if (!decrypted.ok) {
      return { status: 500, data: { error: decryptFailureMessage(decrypted.reason) } }
    }

    const emailConfig = {
      email: emailConfigDoc.email,
      password: decrypted.value,
      fromName: sanitizeFromName(emailConfigDoc.fromName),
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailConfig.email,
        pass: emailConfig.password,
      },
    })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await transporter.sendMail({
      from: `"${emailConfig.fromName}" <${emailConfig.email}>`,
      to: to,
      subject: subject,
      text: message,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            Best regards,<br>
            ${escapeHtml(emailConfig.fromName)}
          </p>
        </div>
      `,
      attachments: [
        {
          filename: (file.name || 'attachment').replace(/[\r\n\\/]+/g, '_').slice(0, 200),
          content: buffer,
          contentType: file.type || undefined,
        },
      ],
    })

    return {
      data: {
        message: 'File sent successfully',
        sent: true,
        recipient: to,
      },
    }
  },
})
