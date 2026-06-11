/**
 * PATCH /api/user/password — change the signed-in user's password.
 *
 * Requires the current password (defense-in-depth: prevents
 * session-hijack → account takeover by anyone who steals only the JWT
 * cookie). On success, bumps `passwordChangedAt` so any other
 * outstanding JWTs are invalidated on next request.
 *
 * Rate-limited per user to slow down attempts to brute-force the
 * current-password field if a session is somehow compromised.
 */

import bcrypt from 'bcryptjs'
import { handler } from '@/lib/api/handler'
import { User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { auth as authSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'

export const PATCH = handler({
  auth: 'session',
  body: authSchemas.changePasswordBody,
  name: 'PATCH /api/user/password',
  fn: async ({ session, body, request }) => {
    const verdict = await checkRateLimit(
      request,
      'pwd-change',
      { limit: 5, windowMs: 15 * 60_000 },
      session!.user.id,
    )
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many attempts. Try again later.' } }
    }

    if (body.currentPassword === body.newPassword) {
      return {
        status: 400,
        data: { error: 'New password must differ from current password.' },
      }
    }

    const user = await User.findById(session!.user.id).select('hashedPassword')
    if (!user || !user.hashedPassword) {
      return { status: 404, data: { error: 'User not found' } }
    }

    const matches = await bcrypt.compare(body.currentPassword, user.hashedPassword)
    if (!matches) {
      await audit({
        userId: session!.user.id,
        action: 'user.password.change_failed',
        resourceType: 'User',
        resourceId: session!.user.id,
        request,
      })
      return { status: 401, data: { error: 'Current password is incorrect.' } }
    }

    user.hashedPassword = await bcrypt.hash(body.newPassword, 12)
    user.passwordChangedAt = new Date()
    await user.save()

    await audit({
      userId: session!.user.id,
      action: 'user.password.change',
      resourceType: 'User',
      resourceId: session!.user.id,
      request,
    })

    return { data: { ok: true } }
  },
})
