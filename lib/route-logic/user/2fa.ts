/**
 * PATCH /api/user/2fa — finalize or disable two-factor authentication.
 *
 * Body shapes:
 *   { action: 'enable',  code: '123456' }          — finishes enrollment
 *   { action: 'disable', password: '...' }         — turns 2FA back off
 *
 * Enable verifies the supplied TOTP against the pending secret minted
 * by `/api/user/2fa/setup`. Disable requires the current password as a
 * second factor so a stolen session cookie alone can't strip the user's
 * 2FA back off the account.
 */

import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { handler } from '@/lib/api/handler'
import { User } from '@/lib/models'
import { decryptTwoFactorSecret } from '@/lib/encryption'
import { verifyTotpStep } from '@/lib/totp'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'

const body = z.union([
  z.object({
    action: z.literal('enable'),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, '6-digit code required'),
  }),
  z.object({
    action: z.literal('disable'),
    password: z.string().min(1).max(200),
    // Disable also requires the current TOTP (6 digits) or a backup
    // code (XXXX-XXXX). Without this, an attacker holding a stolen
    // session AND the password — e.g. via a successful phishing —
    // could strip 2FA off the account without ever possessing the
    // second factor.
    code: z.string().trim().min(6).max(20),
  }),
])

export const PATCH = handler({
  auth: 'session',
  body,
  name: 'PATCH /api/user/2fa',
  fn: async ({ session, body, request }) => {
    const verdict = await checkRateLimit(
      request,
      '2fa-change',
      { limit: 10, windowMs: 15 * 60_000 },
      session!.user.id,
    )
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many attempts. Try again later.' } }
    }

    const user = await User.findById(session!.user.id).select(
      '+twoFactorSecret +twoFactorBackupCodes hashedPassword twoFactorEnabled twoFactorLastUsedStep',
    )
    if (!user) return { status: 404, data: { error: 'User not found' } }

    if (body.action === 'enable') {
      if (!user.twoFactorSecret) {
        return {
          status: 400,
          data: { error: 'No 2FA enrollment in progress. Start setup first.' },
        }
      }
      let secret: string
      try {
        secret = decryptTwoFactorSecret(user.twoFactorSecret)
      } catch {
        return { status: 500, data: { error: 'Could not read enrollment secret.' } }
      }
      // Replay-safe verify (same pattern as login + disable): consume
      // the matched TOTP step atomically so the SAME code can't also
      // be used by a concurrent login or another enroll-confirm
      // request inside the 30s skew window.
      const step = verifyTotpStep(secret, body.code)
      let totpAccepted = false
      if (step !== null) {
        const claim = await User.updateOne(
          {
            _id: user._id,
            $or: [
              { twoFactorLastUsedStep: { $exists: false } },
              { twoFactorLastUsedStep: null },
              { twoFactorLastUsedStep: { $lt: step } },
            ],
          },
          { $set: { twoFactorLastUsedStep: step } },
        )
        totpAccepted = claim.modifiedCount === 1
      }
      if (!totpAccepted) {
        await audit({
          userId: session!.user.id,
          action: 'user.2fa.enroll_failed',
          resourceType: 'User',
          resourceId: session!.user.id,
          request,
        })
        return { status: 401, data: { error: 'Code did not match. Try again.' } }
      }

      user.twoFactorEnabled = true
      await user.save()

      await audit({
        userId: session!.user.id,
        action: 'user.2fa.enabled',
        resourceType: 'User',
        resourceId: session!.user.id,
        request,
      })

      return { data: { ok: true } }
    }

    // action === 'disable'
    if (!user.hashedPassword) {
      return { status: 500, data: { error: 'Account has no password set.' } }
    }
    const matches = await bcrypt.compare(body.password, user.hashedPassword)
    if (!matches) {
      await audit({
        userId: session!.user.id,
        action: 'user.2fa.disable_failed',
        resourceType: 'User',
        resourceId: session!.user.id,
        metadata: { reason: 'bad-password' },
        request,
      })
      return { status: 401, data: { error: 'Password is incorrect.' } }
    }

    // Also require possession of the second factor. Either a 6-digit
    // TOTP OR a one-use backup code is acceptable.
    //
    // 6-digit path uses the SAME atomic replay guard as login (see
    // `app/auth.ts`). Without this, a TOTP code that the legitimate user
    // already burned during their last login could be replayed within
    // its 30s skew window to strip 2FA off the account. Anyone who has
    // already obtained the session cookie + password (phishing,
    // shoulder-surfing, …) only needs to glance at the authenticator
    // once and pivot to disable.
    const trimmed = body.code.replace(/[\s-]/g, '')
    let factorOk = false
    if (/^\d{6}$/.test(trimmed) && user.twoFactorSecret) {
      try {
        const secret = decryptTwoFactorSecret(user.twoFactorSecret)
        const step = verifyTotpStep(secret, trimmed)
        if (step !== null) {
          const claim = await User.updateOne(
            {
              _id: user._id,
              $or: [
                { twoFactorLastUsedStep: { $exists: false } },
                { twoFactorLastUsedStep: null },
                { twoFactorLastUsedStep: { $lt: step } },
              ],
            },
            { $set: { twoFactorLastUsedStep: step } },
          )
          factorOk = claim.modifiedCount === 1
        }
      } catch {
        factorOk = false
      }
    }
    if (!factorOk && Array.isArray(user.twoFactorBackupCodes)) {
      const normalized = body.code.toUpperCase().replace(/[^A-Z0-9-]/g, '')
      // Atomic consume-on-match (same race-safety pattern as login).
      if (normalized.length >= 9) {
        for (const hash of user.twoFactorBackupCodes) {
          // eslint-disable-next-line no-await-in-loop
          if (await bcrypt.compare(normalized, hash)) {
            // eslint-disable-next-line no-await-in-loop
            const res = await User.updateOne(
              { _id: user._id, twoFactorBackupCodes: hash },
              { $pull: { twoFactorBackupCodes: hash } },
            )
            if (res.modifiedCount === 1) factorOk = true
            break
          }
        }
      }
    }
    if (!factorOk) {
      await audit({
        userId: session!.user.id,
        action: 'user.2fa.disable_failed',
        resourceType: 'User',
        resourceId: session!.user.id,
        metadata: { reason: 'bad-totp' },
        request,
      })
      return { status: 401, data: { error: 'Authentication code is incorrect.' } }
    }

    user.twoFactorEnabled = false
    user.twoFactorSecret = undefined
    user.twoFactorBackupCodes = []
    await user.save()

    await audit({
      userId: session!.user.id,
      action: 'user.2fa.disabled',
      resourceType: 'User',
      resourceId: session!.user.id,
      request,
    })

    return { data: { ok: true } }
  },
})
