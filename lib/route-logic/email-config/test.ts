import { EmailConfig } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { logError } from '@/lib/log'
import { createGmailTransport } from '@/lib/mail/create-transport'
import { formatMailError } from '@/lib/mail/format-mail-error'
import { loadOrgEmailConfig } from '@/lib/mail/load-org-email-config'

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

    const credsResult = await loadOrgEmailConfig(ctx!.organizationId)
    if (!credsResult.ok) {
      return { status: credsResult.status, data: { error: credsResult.error } }
    }
    const creds = credsResult.config

    const transporter = createGmailTransport({
      email: creds.email,
      password: creds.password,
    })

    const now = new Date()
    const configDoc = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    try {
      await transporter.sendMail({
        from: `"${creds.fromName}" <${creds.email}>`,
        to: creds.email,
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

      if (configDoc) {
        await EmailConfig.updateOne(
          { _id: configDoc._id },
          { $set: { lastTestAt: now, lastTestStatus: 'success', lastTestError: null } },
        )
      }
    } catch (err: unknown) {
      const error = formatMailError(err)
      logError(err, {
        module: 'email-config.test',
        organizationId: ctx!.organizationId,
        email: creds.email,
      })
      if (configDoc) {
        await EmailConfig.updateOne(
          { _id: configDoc._id },
          { $set: { lastTestAt: now, lastTestStatus: 'failed', lastTestError: error } },
        )
      }
      return { status: 502, data: { error } }
    }

    return {
      data: {
        message: 'Test email sent successfully',
        sent: true,
      },
    }
  },
})
