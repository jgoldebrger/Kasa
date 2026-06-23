import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isPlatformAdminEmail } from '@/lib/platform-admin'
import {
  createImpersonationToken,
  IMPERSONATION_MAX_AGE_SEC,
  verifyImpersonationToken,
} from '@/lib/platform-impersonation-token'

export const PLATFORM_IMPERSONATION_COOKIE = 'kasa_platform_impersonate'

export async function readImpersonationOrgId(userId: string): Promise<string | null> {
  try {
    const token = (await cookies()).get(PLATFORM_IMPERSONATION_COOKIE)?.value
    if (!token) return null
    return verifyImpersonationToken(token, userId)
  } catch {
    return null
  }
}

/** True when a platform admin is viewing an org via support impersonation. */
export async function isPlatformImpersonating(
  userId: string,
  email: string | null | undefined,
  organizationId: string,
): Promise<boolean> {
  if (!isPlatformAdminEmail(email)) return false
  const impersonatedOrgId = await readImpersonationOrgId(userId)
  return impersonatedOrgId === organizationId
}

export function setImpersonationCookies(
  res: NextResponse,
  userId: string,
  orgId: string,
  activeOrgCookieName: string,
): boolean {
  const token = createImpersonationToken(userId, orgId)
  if (!token) return false

  const secure = process.env.NODE_ENV === 'production'
  res.cookies.set(PLATFORM_IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: IMPERSONATION_MAX_AGE_SEC,
  })
  res.cookies.set(activeOrgCookieName, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: IMPERSONATION_MAX_AGE_SEC,
  })
  return true
}

export function clearImpersonationCookies(res: NextResponse, activeOrgCookieName: string): void {
  const secure = process.env.NODE_ENV === 'production'
  res.cookies.set(PLATFORM_IMPERSONATION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  })
  res.cookies.set(activeOrgCookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  })
}
