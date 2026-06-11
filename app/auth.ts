import NextAuth from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import connectDB from '@/lib/database'
import { User, OrgMembership } from '@/lib/models'
import authConfig from './auth.config'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { decrypt } from '@/lib/encryption'
import { verifyTotpStep } from '@/lib/totp'
import type { Role } from '@/types/auth'

// Re-check the user's passwordChangedAt + memberships at most once per this
// many seconds per token. Keeps a sane upper bound on DB load while still
// revoking JWTs shortly after a password reset and picking up membership
// changes quickly.
const TOKEN_REFRESH_TTL_SEC = 30

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        // Optional second factor. Provided by the login form only when
        // the /api/auth/precheck-2fa endpoint says the account has TOTP
        // enabled. Submitted as a 6-digit string OR a `XXXX-XXXX` backup
        // code; we accept either.
        totpCode: { label: '2FA code', type: 'text' },
      },
      async authorize(credentials, request) {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim()
        const password = credentials?.password as string | undefined
        const totpCode = (credentials?.totpCode as string | undefined)?.trim() || ''
        if (!email || !password) return null

        // Rate limit credential attempts per IP and per attempted email.
        // The per-email cap blunts credential-stuffing attacks that rotate
        // through proxy IPs to bypass the IP cap.
        if (request) {
          const ipVerdict = await checkRateLimit(request, 'login', { limit: 5, windowMs: 15 * 60_000 })
          if (!ipVerdict.allowed) {
            // PII scrubbing: never log the attempted email at INFO/WARN
            // level. It's still captured in the audit row below.
            console.warn('[auth] login rate limit hit')
            return null
          }
          const emailVerdict = await checkRateLimit(request, 'login-email', { limit: 10, windowMs: 60 * 60_000 }, email)
          if (!emailVerdict.allowed) {
            console.warn('[auth] login per-email rate limit hit')
            return null
          }
        }

        try {
          await connectDB()
          // Select 2FA fields explicitly — they're marked `select: false`
          // on the schema so default reads don't ship them.
          const user = await User.findOne({ email })
            .select(
              '+twoFactorSecret +twoFactorBackupCodes email hashedPassword name twoFactorEnabled twoFactorLastUsedStep',
            )
            .lean<{
              _id: any
              email: string
              hashedPassword: string
              name: string
              twoFactorEnabled?: boolean
              twoFactorSecret?: string
              twoFactorBackupCodes?: string[]
              twoFactorLastUsedStep?: number
            }>()
          if (!user) {
            // Audit failed attempt — useful for spotting credential stuffing
            // even when the email doesn't exist in the DB.
            audit({
              action: 'auth.login.failed',
              resourceType: 'User',
              metadata: { attemptedEmail: email, reason: 'unknown_user' },
              request: request as Request,
            }).catch(() => {})
            return null
          }

          const ok = await bcrypt.compare(password, user.hashedPassword)
          if (!ok) {
            audit({
              userId: user._id.toString(),
              action: 'auth.login.failed',
              resourceType: 'User',
              resourceId: user._id,
              metadata: { attemptedEmail: email, reason: 'bad_password' },
              request: request as Request,
            }).catch(() => {})
            return null
          }

          // Second factor — only enforced if the user has enrolled.
          if (user.twoFactorEnabled) {
            if (!totpCode) {
              audit({
                userId: user._id.toString(),
                action: 'auth.login.failed',
                resourceType: 'User',
                resourceId: user._id,
                metadata: { attemptedEmail: email, reason: 'missing_totp' },
                request: request as Request,
              }).catch(() => {})
              return null
            }

            const twoFactorOk = await verifyTwoFactor(user, totpCode)
            if (!twoFactorOk) {
              audit({
                userId: user._id.toString(),
                action: 'auth.login.failed',
                resourceType: 'User',
                resourceId: user._id,
                metadata: { attemptedEmail: email, reason: 'bad_totp' },
                request: request as Request,
              }).catch(() => {})
              return null
            }
          }

          audit({
            userId: user._id.toString(),
            action: 'auth.login.success',
            resourceType: 'User',
            resourceId: user._id,
            metadata: { email: user.email },
            request: request as Request,
          }).catch(() => {})

          return {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
          }
        } catch (err) {
          console.error('[auth] authorize error:', err)
          return null
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Server-side JWT check: invalidate any token whose `iat` is older than
    // the user's current `passwordChangedAt`. The edge auth.config callback
    // can't hit Mongo, so the gate effectively lives here — every API call
    // resolves `auth()` which triggers this callback. We also stuff the
    // user's org memberships into the token so requireOrg() can skip a DB
    // lookup on every request.
    async jwt(params) {
      const baseJwt = authConfig.callbacks?.jwt
      const next: JWT = baseJwt ? await baseJwt(params) : params.token

      // On sign-in: refresh memberships immediately so the first request
      // after login already has them in the token.
      const isSignIn = Boolean(params.user)
      if (isSignIn && next?.id) {
        await refreshTokenSideData(next)
        return next
      }

      if (!next?.id) return next

      const now = Math.floor(Date.now() / 1000)
      const lastCheck = typeof next.pwdCheckedAt === 'number' ? next.pwdCheckedAt : 0
      if (now - lastCheck < TOKEN_REFRESH_TTL_SEC) return next

      try {
        await connectDB()
        const u = await User.findById(next.id as string).select('passwordChangedAt').lean<{
          passwordChangedAt?: Date
        }>()
        if (!u) {
          // User no longer exists (deleted, etc.) — kill the token.
          delete next.id
          return next
        }
        if (u.passwordChangedAt) {
          const changedAtSec = Math.floor(new Date(u.passwordChangedAt).getTime() / 1000)
          const tokenIat = typeof next.iat === 'number' ? next.iat : 0
          // Strict greater-than: a token issued at or after the
          // password change is still valid. Using `>=` here caused a
          // same-second race where a user who reset their password and
          // logged back in within the same wall-clock second would be
          // force-logged-out on the next request (passwordChangedAt
          // and iat both rounded to the same epoch second).
          if (changedAtSec > tokenIat) {
            delete next.id
            return next
          }
        }
        // Refresh org memberships in the same hop — same throttle window.
        await refreshTokenSideData(next)
      } catch (err) {
        // Fail closed for the auth-critical password-revocation check:
        // if Mongo is degraded we cannot prove the token is still valid
        // post-reset, so we drop the token rather than letting a stolen
        // session survive a password change. The user just re-logs in.
        console.error('[auth.jwt] revocation check failed (fail-closed):', err)
        delete next.id
        return next
      }

      return next
    },
    async session(params) {
      const baseSession = authConfig.callbacks?.session
      const result = baseSession ? await baseSession(params) : params.session
      // Thread memberships through so requireOrg can read from the session
      // without a DB hit. Shape: [{ o: orgId, r: role }, ...]
      if (result?.user) {
        result.user.memberships = params.token.memberships || []
      }
      return result
    },
  },
})

/**
 * Verify the supplied second factor against the user record. Accepts
 * either a 6-digit TOTP from an authenticator app OR a one-use backup
 * code (`XXXX-XXXX`). A consumed backup code is removed from the array
 * so it can never be replayed.
 */
async function verifyTwoFactor(
  user: {
    _id: any
    twoFactorSecret?: string
    twoFactorBackupCodes?: string[]
    twoFactorLastUsedStep?: number
  },
  code: string,
): Promise<boolean> {
  if (!code) return false

  // 6-digit TOTP path with replay protection.
  const digitsOnly = code.replace(/\D/g, '')
  if (digitsOnly.length === 6 && user.twoFactorSecret) {
    try {
      const secret = decrypt(user.twoFactorSecret)
      const step = verifyTotpStep(secret, digitsOnly)
      if (step !== null) {
        // Atomic replay guard: only accept the code if its HOTP step is
        // strictly newer than the last successful one. Without this an
        // intercepted code could be replayed within the ±30s skew window.
        const updated = await User.updateOne(
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
        if (updated.modifiedCount === 1) return true
        // Otherwise: another login already consumed this step. Treat as
        // replay → reject.
        return false
      }
    } catch {
      // Fall through to backup-code path.
    }
  }

  // Backup-code path. Atomic consume-on-match: if two concurrent login
  // requests race here with the same backup code, only the request whose
  // `$pull` actually removes the hash wins. The other gets
  // `modifiedCount: 0` and is rejected even though `bcrypt.compare`
  // returned true — preventing single-use codes from authenticating
  // twice under concurrency.
  const normalized = code.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (normalized.length >= 9 && user.twoFactorBackupCodes?.length) {
    for (const hash of user.twoFactorBackupCodes) {
      if (await bcrypt.compare(normalized, hash)) {
        const res = await User.updateOne(
          { _id: user._id, twoFactorBackupCodes: hash },
          { $pull: { twoFactorBackupCodes: hash } },
        )
        if (res.modifiedCount === 1) return true
        // Lost the race — another login already consumed this code.
        return false
      }
    }
  }
  return false
}

/**
 * Pull membership rows for this user and stash a compact form on the token.
 * Called from the JWT callback at sign-in time and at most once per TTL.
 */
async function refreshTokenSideData(token: JWT): Promise<void> {
  try {
    await connectDB()
    const memberships = await OrgMembership.find({ userId: token.id })
      .select('organizationId role')
      .lean<{ organizationId: { toString(): string }; role: Role }[]>()
    token.memberships = memberships.map((m) => ({
      o: m.organizationId.toString(),
      r: m.role,
    }))
    token.pwdCheckedAt = Math.floor(Date.now() / 1000)
  } catch (err) {
    console.error('[auth.jwt] memberships refresh failed:', err)
  }
}
