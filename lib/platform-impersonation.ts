import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isPlatformAdminEmail } from '@/lib/platform-admin'
import {
  createImpersonationToken,
  IMPERSONATION_MAX_AGE_SEC,
  readImpersonationDetails,
  type ImpersonationDetails,
} from '@/lib/platform-impersonation-token'

export const PLATFORM_IMPERSONATION_COOKIE = 'kasa_platform_impersonate'

async function readImpersonationSessionDetails(
  userId: string,
): Promise<ImpersonationDetails | null> {
  try {
    const token = (await cookies()).get(PLATFORM_IMPERSONATION_COOKIE)?.value
    if (!token) return null
    return readImpersonationDetails(token, userId)
  } catch {
    return null
  }
}

export async function readImpersonationOrgId(userId: string): Promise<string | null> {
  const details = await readImpersonationSessionDetails(userId)
  return details?.orgId ?? null
}

export async function readImpersonationReadOnly(userId: string): Promise<boolean> {
  const details = await readImpersonationSessionDetails(userId)
  return details?.readOnly ?? false
}

export async function readImpersonationExpiresAt(userId: string): Promise<number | null> {
  const details = await readImpersonationSessionDetails(userId)
  return details?.expiresAt ?? null
}

export async function readImpersonationStartedAt(userId: string): Promise<number | null> {
  const details = await readImpersonationSessionDetails(userId)
  return details?.startedAt ?? null
}

/** Full impersonation session from the httpOnly cookie (null if inactive/invalid). */
export async function readImpersonationSession(
  userId: string,
): Promise<ImpersonationDetails | null> {
  return readImpersonationSessionDetails(userId)
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
  readOnly?: boolean,
): boolean {
  const token = createImpersonationToken(userId, orgId, readOnly)
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
