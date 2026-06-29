import { PLATFORM_ADMIN_TOTP_REVERIFY_CODE } from '@/lib/platform-admin-constants'

export type PlatformAdminTotpStatus = {
  verified: boolean
  verifiedAt: number | null
  expiresAt: number | null
  validForSeconds: number
}

export async function fetchPlatformAdminTotpStatus(): Promise<PlatformAdminTotpStatus | null> {
  try {
    const res = await fetch('/api/admin/verify-totp')
    if (!res.ok) return null
    return (await res.json()) as PlatformAdminTotpStatus
  } catch {
    return null
  }
}

export function isPlatformAdminTotpReverifyError(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: string }).code === PLATFORM_ADMIN_TOTP_REVERIFY_CODE
  )
}

export async function needsPlatformAdminTotpForWrite(): Promise<boolean> {
  const status = await fetchPlatformAdminTotpStatus()
  return !status?.verified
}
