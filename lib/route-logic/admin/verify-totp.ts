/**
 * GET  /api/admin/verify-totp — recent step-up TOTP status.
 * POST /api/admin/verify-totp — verify TOTP and mint a short-lived cookie.
 */

import { z } from 'zod'
import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertPlatformAdminTwoFactor } from '@/lib/platform-admin'
import {
  readPlatformAdminTotpFromRequest,
  setPlatformAdminTotpCookie,
  PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
} from '@/lib/platform-admin-totp'
import { verifyTwoFactorCode } from '@/lib/two-factor-verify'

export const dynamic = 'force-dynamic'

const postBody = z.object({
  code: z.string().trim().min(6).max(20),
})

export const GET = handler({
  auth: 'admin',
  platformAdminTwoFactor: true,
  name: 'GET /api/admin/verify-totp',
  fn: async ({ session, request }) => {
    const status = readPlatformAdminTotpFromRequest(request, session!.user.id)
    return {
      data: {
        verified: status.verified,
        verifiedAt: status.verifiedAt,
        expiresAt: status.verifiedAt ? status.verifiedAt + PLATFORM_ADMIN_TOTP_MAX_AGE_SEC : null,
        validForSeconds: PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
      },
    }
  },
})

export const POST = handler({
  auth: 'admin',
  platformAdminTwoFactor: true,
  body: postBody,
  name: 'POST /api/admin/verify-totp',
  fn: async ({ session, body, request }) => {
    const verdict = await checkRateLimit(
      request,
      'admin-totp-verify',
      { limit: 10, windowMs: 15 * 60_000 },
      session!.user.id,
    )
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many attempts. Try again later.' } }
    }

    const tfaBlock = await assertPlatformAdminTwoFactor(session!.user.id)
    if (tfaBlock) return tfaBlock

    const user = await User.findById(session!.user.id).select(
      '+twoFactorSecret +twoFactorBackupCodes twoFactorEnabled twoFactorLastUsedStep',
    )
    if (!user?.twoFactorEnabled) {
      return { status: 403, data: { error: 'Two-factor authentication is not enabled.' } }
    }

    const ok = await verifyTwoFactorCode(user, body.code)
    if (!ok) {
      await audit({
        userId: session!.user.id,
        action: 'platform.admin.totp_verify_failed',
        resourceType: 'User',
        resourceId: session!.user.id,
        request,
      })
      return { status: 401, data: { error: 'Authentication code is incorrect.' } }
    }

    const res = NextResponse.json({
      ok: true,
      verified: true,
      validForSeconds: PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
    })
    if (!setPlatformAdminTotpCookie(res, session!.user.id)) {
      return { status: 500, data: { error: 'Could not record verification.' } }
    }

    await audit({
      userId: session!.user.id,
      action: 'platform.admin.totp_verified',
      resourceType: 'User',
      resourceId: session!.user.id,
      request,
    })

    return res
  },
})
