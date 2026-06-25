import { EmailConfig } from '@/lib/models'
import { encrypt, safeDecrypt } from '@/lib/encryption'
import { audit } from '@/lib/audit'
import { sanitizeFromName } from '@/lib/email-from-name'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailConfig as emailConfigSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { createGmailTransport } from '@/lib/mail/create-transport'
import { formatMailError } from '@/lib/mail/format-mail-error'
import { normalizeGmailAppPassword } from '@/lib/mail/normalize-app-password'

async function verifySmtpCreds(creds: {
  email: string
  password: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = createGmailTransport(creds)
  try {
    await transporter.verify()
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: formatMailError(err) }
  }
}

// GET - Get email configuration
//
// "No config yet" is a normal first-run state, not an error. Returning 404
// for it pollutes DevTools / Sentry with red entries and gets reported by
// uptime checks. Instead we return 200 with `configured: false` so callers
// can distinguish "not set up" from "request failed".
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/email-config',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-config-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const config = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    if (!config) {
      return {
        data: { configured: false },
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
      }
    }

    return {
      data: {
        configured: true,
        email: config.email,
        fromName: config.fromName,
        isActive: config.isActive,
        lastTestAt: config.lastTestAt ?? null,
        lastTestStatus: config.lastTestStatus ?? null,
        lastTestError: config.lastTestError ?? null,
      },
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})

const saveEmailConfig = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailConfigSchemas.emailConfigBody,
  name: 'POST /api/email-config',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-config-save',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { email, fromName } = body
    const normalizedPassword = body.password ? normalizeGmailAppPassword(body.password) : undefined

    const existingConfig = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    if (existingConfig) {
      const cleanedFromName = sanitizeFromName(
        fromName || existingConfig.fromName || 'Kasa Family Management',
      )
      const updateData: Record<string, unknown> = {
        email,
        fromName: cleanedFromName,
      }

      let verifyPassword = normalizedPassword
      if (!verifyPassword) {
        const decrypted = safeDecrypt(existingConfig.password)
        if (!decrypted.ok) {
          return { status: 500, data: { error: 'Stored email password could not be decrypted.' } }
        }
        verifyPassword = decrypted.value
      }

      const verify = await verifySmtpCreds({ email, password: verifyPassword })
      if (!verify.ok) {
        if (normalizedPassword) {
          // Bad new password — update other fields but not password.
          const updatedConfig = await EmailConfig.findOneAndUpdate(
            { _id: existingConfig._id, organizationId: ctx!.organizationId },
            updateData,
            { new: true },
          )
          await audit({
            organizationId: ctx!.organizationId,
            userId: ctx!.userId,
            action: 'email_config.update',
            resourceType: 'EmailConfig',
            resourceId: existingConfig._id,
            metadata: { email, fromName: cleanedFromName, passwordChanged: false },
            request,
          })
          return {
            status: 400,
            data: {
              error: verify.error,
              email: updatedConfig!.email,
              fromName: updatedConfig!.fromName,
              isActive: updatedConfig!.isActive,
            },
          }
        }
        return { status: 400, data: { error: verify.error } }
      }

      if (normalizedPassword) {
        updateData.password = encrypt(normalizedPassword)
      }

      const updatedConfig = await EmailConfig.findOneAndUpdate(
        { _id: existingConfig._id, organizationId: ctx!.organizationId },
        updateData,
        { new: true },
      )

      await audit({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        action: 'email_config.update',
        resourceType: 'EmailConfig',
        resourceId: existingConfig._id,
        metadata: { email, fromName: cleanedFromName, passwordChanged: !!normalizedPassword },
        request,
      })

      return {
        data: {
          email: updatedConfig!.email,
          fromName: updatedConfig!.fromName,
          isActive: updatedConfig!.isActive,
        },
      }
    }

    if (!normalizedPassword) {
      return { status: 400, data: { error: 'Password is required for new email configuration' } }
    }

    const verify = await verifySmtpCreds({ email, password: normalizedPassword })
    if (!verify.ok) {
      return { status: 400, data: { error: verify.error } }
    }

    await EmailConfig.updateMany({ organizationId: ctx!.organizationId }, { isActive: false })

    const config = await EmailConfig.create({
      email,
      password: encrypt(normalizedPassword),
      fromName: sanitizeFromName(fromName || 'Kasa Family Management'),
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_config.create',
      resourceType: 'EmailConfig',
      resourceId: config._id,
      metadata: { email, fromName: config.fromName },
      request,
    })

    return {
      status: 201,
      data: {
        email: config.email,
        fromName: config.fromName,
        isActive: config.isActive,
      },
    }
  },
})

// POST - Create or update email configuration
export const POST = saveEmailConfig

// PUT mirrors POST for clients that prefer idempotent update semantics.
export const PUT = saveEmailConfig
