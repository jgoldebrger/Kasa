import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import connectDB from '@/lib/database'
import { User } from '@/lib/models'
import {
  PLATFORM_ADMIN_2FA_REQUIRED_CODE,
  PLATFORM_ADMIN_2FA_REQUIRED_MESSAGE,
} from '@/lib/platform-admin-constants'

export { PLATFORM_ADMIN_2FA_REQUIRED_CODE, PLATFORM_ADMIN_2FA_REQUIRED_MESSAGE }
/**
 * "SaaS owner" / platform-admin gate.
 *
 * A user is treated as a platform admin if their email appears in the
 * `PLATFORM_ADMIN_EMAILS` env var (comma-separated, case-insensitive).
 * No DB flag is required — this keeps the source of truth in env config.
 *
 * Use in API routes:
 *   const gate = await requirePlatformAdmin()
 *   if (gate instanceof NextResponse) return gate
 *   const { email } = gate
 */

function getAllowedEmails(): Set<string> {
  return new Set(getPlatformAdminEmails().map((e) => e.toLowerCase()))
}

/** Comma-separated `PLATFORM_ADMIN_EMAILS` as a trimmed list (case preserved). */
export function getPlatformAdminEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = getAllowedEmails()
  if (allowed.size === 0) return false
  return allowed.has(email.toLowerCase().trim())
}

export interface PlatformAdminCtx {
  userId: string
  email: string
  name: string
}

export async function assertPlatformAdminTwoFactor(userId: string): Promise<NextResponse | null> {
  await connectDB()
  const user = await User.findById(userId)
    .select('twoFactorEnabled')
    .lean<{ twoFactorEnabled?: boolean }>()
  if (!user?.twoFactorEnabled) {
    return NextResponse.json(
      { error: PLATFORM_ADMIN_2FA_REQUIRED_MESSAGE, code: PLATFORM_ADMIN_2FA_REQUIRED_CODE },
      { status: 403 },
    )
  }
  return null
}

export async function requirePlatformAdmin(): Promise<PlatformAdminCtx | NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isPlatformAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return {
    userId: session.user.id as string,
    email: session.user.email as string,
    name: session.user.name || '',
  }
}
