/**
 * POST /api/auth/precheck-2fa
 * Body: { email, password }
 *
 * Returns `{ requiresTwoFactor: true | false }` so the login form
 * knows whether to surface the 6-digit code field before calling
 * signIn().
 *
 * Now requires the password too so we don't leak 2FA enrollment status
 * for a known email. Unknown email + wrong password collapse into the
 * same `requiresTwoFactor: false` reply with a bcrypt timing decoy,
 * preventing both account-existence and enrollment enumeration.
 *
 * Rate-limited per IP and per email to slow down credential stuffing.
 */

import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { handler } from '@/lib/api/handler'
import { User } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { email } from '@/lib/schemas/common'

const body = z.object({
  email,
  password: z.string().min(1).max(200),
})

// Pre-computed bcrypt hash of an unguessable string. Used as a
// constant-time decoy when the email isn't found so the response time
// for "no such user" matches "wrong password for real user".
const DECOY_HASH = '$2a$12$Vu0M0r6Mu3y4Pp6n2A1Y/eQp.j0Yc3Y0o1cqgZ1Vw0Hk2zHkH3a/W'

export const POST = handler({
  auth: 'public',
  body,
  name: 'POST /api/auth/precheck-2fa',
  fn: async ({ body, request }) => {
    const ipVerdict = await checkRateLimit(request, 'precheck-2fa', {
      limit: 30,
      windowMs: 15 * 60_000,
    })
    if (!ipVerdict.allowed) {
      return { data: { requiresTwoFactor: false } }
    }
    const emailVerdict = await checkRateLimit(
      request,
      'precheck-2fa-email',
      { limit: 10, windowMs: 60 * 60_000 },
      body.email,
    )
    if (!emailVerdict.allowed) {
      return { data: { requiresTwoFactor: false } }
    }

    const user = await User.findOne({ email: body.email })
      .select('hashedPassword twoFactorEnabled')
      .lean<{ hashedPassword?: string; twoFactorEnabled?: boolean }>()

    // Always perform a bcrypt compare so unknown emails take the same
    // ~250ms our real users do, killing the timing oracle.
    const hashToTest = user?.hashedPassword || DECOY_HASH
    const passwordOk = await bcrypt.compare(body.password, hashToTest)

    if (!user || !passwordOk) {
      return { data: { requiresTwoFactor: false } }
    }

    return { data: { requiresTwoFactor: !!user.twoFactorEnabled } }
  },
})
