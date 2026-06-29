import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  PLATFORM_ADMIN_TOTP_COOKIE,
  PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
  createPlatformAdminTotpToken,
  isPlatformAdminTotpTokenValid,
  readPlatformAdminTotpVerifiedAt,
} from '@/lib/platform-admin-totp-token'
import {
  PLATFORM_ADMIN_TOTP_REVERIFY_CODE,
  PLATFORM_ADMIN_TOTP_REVERIFY_MESSAGE,
} from '@/lib/platform-admin-constants'

export { PLATFORM_ADMIN_TOTP_COOKIE, PLATFORM_ADMIN_TOTP_MAX_AGE_SEC, createPlatformAdminTotpToken }

export function readPlatformAdminTotpFromRequest(
  request: NextRequest,
  userId: string,
): { verified: boolean; verifiedAt: number | null } {
  const token = request.cookies.get(PLATFORM_ADMIN_TOTP_COOKIE)?.value
  if (!token) return { verified: false, verifiedAt: null }
  const verifiedAt = readPlatformAdminTotpVerifiedAt(token, userId)
  return { verified: verifiedAt !== null, verifiedAt }
}

export async function readPlatformAdminTotpSession(
  userId: string,
): Promise<{ verified: boolean; verifiedAt: number | null; expiresAt: number | null }> {
  try {
    const token = (await cookies()).get(PLATFORM_ADMIN_TOTP_COOKIE)?.value
    if (!token) return { verified: false, verifiedAt: null, expiresAt: null }
    const verifiedAt = readPlatformAdminTotpVerifiedAt(token, userId)
    if (verifiedAt === null) return { verified: false, verifiedAt: null, expiresAt: null }
    return {
      verified: true,
      verifiedAt,
      expiresAt: verifiedAt + PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
    }
  } catch {
    return { verified: false, verifiedAt: null, expiresAt: null }
  }
}

export function assertRecentPlatformAdminTotp(
  request: NextRequest,
  userId: string,
): NextResponse | null {
  const token = request.cookies.get(PLATFORM_ADMIN_TOTP_COOKIE)?.value
  if (!token || !isPlatformAdminTotpTokenValid(token, userId)) {
    return NextResponse.json(
      { error: PLATFORM_ADMIN_TOTP_REVERIFY_MESSAGE, code: PLATFORM_ADMIN_TOTP_REVERIFY_CODE },
      { status: 403 },
    )
  }
  return null
}

export function setPlatformAdminTotpCookie(res: NextResponse, userId: string): boolean {
  const token = createPlatformAdminTotpToken(userId)
  if (!token) return false
  const secure = process.env.NODE_ENV === 'production'
  res.cookies.set(PLATFORM_ADMIN_TOTP_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
  })
  return true
}
