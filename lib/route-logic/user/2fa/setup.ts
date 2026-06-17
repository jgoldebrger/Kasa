/**
 * POST /api/user/2fa/setup — start TOTP enrollment.
 *
 * Mints a fresh base32 secret, stores it encrypted on the user record
 * (but does NOT flip `twoFactorEnabled` yet — that requires a verified
 * code via PATCH /api/user/2fa), and returns the otpauth:// URI plus a
 * fresh set of backup codes.
 *
 * Calling this endpoint multiple times while 2FA has NEVER been enabled
 * just overwrites the pending secret — fine, enrollment hasn't been
 * confirmed yet. However, once 2FA IS enabled, re-enrollment must require
 * the user to prove they still control the existing factor (current
 * password + valid TOTP or backup code) so a stolen session can't
 * rotate the secret out from under the real owner.
 */

import { handler } from '@/lib/api/handler'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { User, Organization } from '@/lib/models'
import { encrypt, decryptTwoFactorSecret } from '@/lib/encryption'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  buildOtpauthUrl,
  generateBackupCodes,
  generateTotpSecret,
  verifyTotpStep,
} from '@/lib/totp'

const body = z.object({
  // Always required: confirms the current account password before any
  // 2FA secret is minted. Without this, a stolen session cookie could
  // start a 2FA enrollment that locks the real user out of their
  // account.
  password: z.string().min(1).max(200),
  // Required only when 2FA is already enabled (re-enrollment must
  // prove possession of the *current* second factor). Ignored on the
  // first-time enrollment path.
  code: z.string().trim().min(6).max(20).optional(),
})

export const POST = handler({
  auth: 'session',
  body,
  name: 'POST /api/user/2fa/setup',
  fn: async ({ session, body, request }) => {
    // Throttle setup attempts: this endpoint accepts both a password
    // verify AND (for re-enroll) a TOTP/backup-code verify. Without a
    // rate limit, a stolen session cookie can brute force either.
    const verdict = await checkRateLimit(
      request,
      '2fa-setup',
      { limit: 10, windowMs: 15 * 60_000 },
      session!.user.id,
    )
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many attempts. Try again later.' } }
    }

    const user = await User.findById(session!.user.id).select(
      '+twoFactorSecret +twoFactorBackupCodes twoFactorLastUsedStep email twoFactorEnabled hashedPassword lastActiveOrganizationId',
    )
    if (!user) return { status: 404, data: { error: 'User not found' } }

    // Always require the current account password as a re-auth gate —
    // even on first-time enrollment. Otherwise a hijacked session can
    // mint an attacker-controlled 2FA secret and lock the real user out.
    if (!user.hashedPassword) {
      return { status: 500, data: { error: 'Account has no password set.' } }
    }
    const passwordOk = await bcrypt.compare(body.password, user.hashedPassword)
    if (!passwordOk) {
      await audit({
        userId: session!.user.id,
        action: user.twoFactorEnabled ? 'user.2fa.reenroll_failed' : 'user.2fa.setup_failed',
        resourceType: 'User',
        resourceId: session!.user.id,
        metadata: { reason: 'bad-password' },
        request,
      })
      return { status: 401, data: { error: 'Password is incorrect.' } }
    }

    // Re-auth wall: if 2FA is already enabled, the caller must also
    // prove they still hold the active second factor before we rotate
    // the secret + backup codes.
    if (user.twoFactorEnabled) {
      const code = body.code
      if (!code) {
        return {
          status: 401,
          data: {
            error: 'Re-authentication required',
            requiresReauth: true,
          },
        }
      }
      // Verify the user still controls the active TOTP — either a 6-digit
      // code OR a backup code (normalised by uppercasing/stripping dashes).
      //
      // The 6-digit path uses the SAME atomic replay guard as login (see
      // `app/auth.ts`). Without this, a TOTP code the legitimate user
      // already burned during their last login could be replayed inside
      // the 30s skew window to trigger a re-enrollment that replaces
      // their authenticator secret and mints fresh backup codes — a
      // device-takeover primitive for anyone with the password + a
      // captured TOTP.
      //
      // The re-enrollment branch below also resets
      // `twoFactorLastUsedStep`, so the user can sign in with the NEW
      // secret immediately without waiting for the next 30s window.
      const trimmed = code.replace(/[\s-]/g, '')
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
        // Match login (`app/auth.ts`): hashes include the dash separator.
        const normalized = code.toUpperCase().replace(/[^A-Z0-9-]/g, '')
        // Atomic consume-on-match: same race-safety pattern as login.
        // Walk the user's hashes, and for each one that matches the
        // submitted code, attempt to pull it from the document. Only
        // count the factor as verified if `modifiedCount === 1` (meaning
        // *this* request is the one that removed it). Two concurrent
        // re-enroll attempts can't both consume the same backup code.
        if (normalized.length >= 9) {
          for (const hash of user.twoFactorBackupCodes) {
            // eslint-disable-next-line no-await-in-loop
            if (await bcrypt.compare(normalized, hash)) {
              // eslint-disable-next-line no-await-in-loop
              const res = await User.updateOne(
                { _id: user._id, twoFactorBackupCodes: hash },
                { $pull: { twoFactorBackupCodes: hash } },
              )
              if (res.modifiedCount === 1) {
                factorOk = true
              }
              break
            }
          }
        }
      }
      if (!factorOk) {
        await audit({
          userId: session!.user.id,
          action: 'user.2fa.reenroll_failed',
          resourceType: 'User',
          resourceId: session!.user.id,
          metadata: { reason: 'bad-totp' },
          request,
        })
        return { status: 401, data: { error: 'Authentication code is incorrect.' } }
      }
    }

    const secret = generateTotpSecret()
    const backupCodes = generateBackupCodes(10)
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)))

    // Pull the active org's name (if any) for a friendlier issuer label
    // in the authenticator app. Prefer the user's `lastActiveOrganizationId`
    // — that's the org they're currently working in. Fall back to the
    // first membership the session knows about, then to "Kasa".
    let issuer = 'Kasa'
    let orgIdForLabel: string | null = null
    if (user.lastActiveOrganizationId) {
      orgIdForLabel = user.lastActiveOrganizationId.toString()
    } else {
      const orgs = (session as any)?.user?.memberships
      if (Array.isArray(orgs) && orgs.length > 0) {
        orgIdForLabel = String(orgs[0].o)
      }
    }
    if (orgIdForLabel) {
      // Verify membership before reading the org name — guards against a
      // stale lastActiveOrganizationId pointing at an org the user no
      // longer belongs to.
      const memberships = (session as any)?.user?.memberships
      const isMember =
        Array.isArray(memberships) && memberships.some((m: any) => String(m.o) === orgIdForLabel)
      if (isMember) {
        const org = await Organization.findById(orgIdForLabel)
          .select('name')
          .lean<{ name?: string }>()
        if (org?.name) issuer = org.name
      }
    }

    user.twoFactorSecret = encrypt(secret)
    // Store the pending backup codes too — they're committed when the
    // user confirms via PATCH /api/user/2fa.
    user.twoFactorBackupCodes = hashedCodes
    // Reset the per-account TOTP replay marker so the user can sign in
    // with the NEW secret immediately. Without this, the re-auth step
    // above just consumed a step and the brand-new authenticator code
    // for that same wall-clock window would be rejected as a replay.
    user.twoFactorLastUsedStep = undefined
    await user.save()

    await audit({
      userId: session!.user.id,
      action: 'user.2fa.setup_started',
      resourceType: 'User',
      resourceId: session!.user.id,
      request,
    })

    const otpauthUrl = buildOtpauthUrl({
      secret,
      accountName: user.email,
      issuer,
    })

    return { data: { otpauthUrl, backupCodes } }
  },
})
