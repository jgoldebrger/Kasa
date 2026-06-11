import { EmailConfig } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { sanitizeFromName } from '@/lib/email-from-name'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import nodemailer from 'nodemailer'

// POST - Send a test email
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'POST /api/email-config/test',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-config-test',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const emailConfigDoc = await EmailConfig.findOne({ isActive: true, organizationId: ctx!.organizationId })

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

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailConfigDoc.email,
        pass: decrypted.value,
      },
    })

    await transporter.sendMail({
      from: `"${sanitizeFromName(emailConfigDoc.fromName)}" <${emailConfigDoc.email}>`,
      to: emailConfigDoc.email,
      subject: 'Test Email - Kasa Family Management',
      text: `This is a test email from Kasa Family Management.

If you received this email, your email configuration is working correctly!

You can now send statements to families via email.

Best regards,
Kasa Family Management System`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #4F46E5;">Test Email - Kasa Family Management</h2>
          <p>This is a test email from Kasa Family Management.</p>
          <p>If you received this email, your email configuration is working correctly!</p>
          <p>You can now send statements to families via email.</p>
          <p>Best regards,<br>Kasa Family Management System</p>
        </div>
      `,
    })

    return {
      data: {
        message: 'Test email sent successfully',
        sent: true,
      },
    }
  },
})
