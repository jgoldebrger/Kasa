import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { User, PasswordResetToken } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { auth as authSchemas } from '@/lib/schemas'
import { sendPlatformEmail, isPlatformEmailConfigured } from '@/lib/platform-email'
import { escapeHtml } from '@/lib/html-escape'
import { z } from 'zod'

const RESET_TTL_MS = 60 * 60 * 1000

const tokenQuery = z.object({
  token: z.string().trim().min(1).max(200),
})

/**
 * Reset tokens are stored as SHA-256(token) instead of cleartext. A DB
 * dump alone is not enough to reset a user's password — the attacker
 * would still need the original token, which only ever lived in the
 * outbound email and the recipient's browser.
 *
 * Old plaintext tokens still in the DB will continue to work until they
 * expire (or are cleaned up) because we look up by both shapes.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * POST — start the reset flow. Always 200 so we don't leak which
 * emails exist. Rate-limited per IP and per email.
 */
export const POST = handler({
  auth: 'public',
  body: authSchemas.resetPasswordRequestBody,
  name: 'POST /api/auth/reset-password',
  fn: async ({ body, request }) => {
    const verdict = await checkRateLimit(request, 'pwd-reset', { limit: 5, windowMs: 15 * 60_000 })
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many reset requests. Try again later.' } }
    }

    const emailVerdict = await checkRateLimit(
      request,
      'pwd-reset-email',
      { limit: 3, windowMs: 60 * 60_000 },
      body.email,
    )
    if (!emailVerdict.allowed) return { data: { ok: true } }

    const user = await User.findOne({ email: body.email })
    if (!user) return { data: { ok: true } }

    try {
      await PasswordResetToken.deleteMany({ userId: user._id })

      const token = crypto.randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + RESET_TTL_MS)
      await PasswordResetToken.create({
        userId: user._id,
        token: hashToken(token),
        expiresAt,
      })

      await audit({
        userId: user._id.toString(),
        action: 'auth.password_reset.requested',
        resourceType: 'User',
        resourceId: user._id,
        metadata: { email: body.email },
        request,
      })

      const resetUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/reset-password/${token}`

      if (isPlatformEmailConfigured()) {
        try {
          const safeEmail = escapeHtml(body.email)
          const safeUrl = escapeHtml(resetUrl)
          const result = await sendPlatformEmail({
            to: body.email,
            subject: 'Reset your Kasa password',
            text:
              `We received a request to reset the password for ${body.email}.\n\n` +
              `Open this link to set a new one (valid for 1 hour):\n${resetUrl}\n\n` +
              `If you didn't ask to reset your password, you can ignore this email.`,
            html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>We received a request to reset the password for <strong>${safeEmail}</strong>.</p>
            <p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;">Reset your password</a></p>
            <p style="font-size:12px;color:#666;">Or paste this link into your browser (valid for 1 hour):<br><span style="word-break:break-all;">${safeUrl}</span></p>
            <p style="font-size:12px;color:#666;">If you didn't ask to reset your password, you can ignore this email.</p>
          </div>
        `,
          })
          if (!result.sent) {
            console.warn(
              '[reset-password] Platform email not sent:',
              result.reason || result.error || 'unknown',
            )
          }
        } catch (err: unknown) {
          console.error(
            '[reset-password] Platform email error:',
            err instanceof Error ? err.message : err,
          )
        }
      } else if (process.env.NODE_ENV !== 'production') {
        console.log(`[reset-password] Reset link for ${body.email}: ${resetUrl}`)
      } else {
        console.warn('[reset-password] Platform SMTP not configured; reset email not delivered.')
      }
    } catch (err: unknown) {
      console.error(
        '[reset-password] Failed to create reset token:',
        err instanceof Error ? err.message : err,
      )
      return {
        status: 503,
        data: { error: 'Password reset is temporarily unavailable. Try again shortly.' },
      }
    }

    return { data: { ok: true } }
  },
})

/**
 * PUT — submit a new password using a valid reset token.
 */
export const PUT = handler({
  auth: 'public',
  body: authSchemas.resetPasswordConfirmBody,
  name: 'PUT /api/auth/reset-password',
  fn: async ({ body, request }) => {
    const verdict = await checkRateLimit(request, 'pwd-reset-confirm', {
      limit: 10,
      windowMs: 15 * 60_000,
    })
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many attempts. Try again later.' } }
    }

    // Look up by hashed form first, then fall back to legacy cleartext
    // tokens that still exist in the DB from before this migration.
    const hashed = hashToken(body.token)
    const record =
      (await PasswordResetToken.findOne({ token: hashed })) ||
      (await PasswordResetToken.findOne({ token: body.token }))
    if (!record) return { status: 404, data: { error: 'Invalid token' } }
    if (record.usedAt) return { status: 410, data: { error: 'Token already used' } }
    if (record.expiresAt < new Date()) return { status: 410, data: { error: 'Token expired' } }

    const hashedPassword = await bcrypt.hash(body.newPassword, 12)

    // Atomic claim of the token: only one concurrent reset request can
    // win this update (filters on `usedAt: null` and unexpired). Without
    // this two reset clicks racing would both apply, and the second one
    // could overwrite the first's password.
    const now = new Date()
    const claim = await PasswordResetToken.findOneAndUpdate(
      { _id: record._id, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { new: true },
    )
    if (!claim) {
      return { status: 410, data: { error: 'Token already used or expired' } }
    }

    // Bump passwordChangedAt so any in-flight JWTs are invalidated on next use.
    await User.findByIdAndUpdate(record.userId, {
      hashedPassword,
      passwordChangedAt: new Date(),
    })

    await audit({
      userId: record.userId?.toString(),
      action: 'auth.password_reset.completed',
      resourceType: 'User',
      resourceId: record.userId,
      request,
    })

    return { data: { ok: true } }
  },
})

/**
 * GET — pre-flight check used by the reset page to validate the token
 * before rendering the form.
 */
export const GET = handler({
  auth: 'public',
  query: tokenQuery,
  name: 'GET /api/auth/reset-password',
  fn: async ({ query }) => {
    const hashed = hashToken(query.token)
    const record =
      (await PasswordResetToken.findOne({ token: hashed }).lean<{
        usedAt?: Date
        expiresAt: Date
      }>()) ||
      (await PasswordResetToken.findOne({ token: query.token }).lean<{
        usedAt?: Date
        expiresAt: Date
      }>())
    // Collapse all failure modes into one opaque verdict so we don't
    // leak token state (existence vs used vs expired) to an attacker
    // who is brute-forcing reset URLs. The client only needs to know
    // valid/invalid before rendering the form.
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return { data: { valid: false } }
    }
    return { data: { valid: true } }
  },
})
