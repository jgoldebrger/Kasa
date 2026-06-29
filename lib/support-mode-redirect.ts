/** Allowed post-impersonation landing paths for platform support mode. */
export const SUPPORT_MODE_REDIRECTS = ['/', '/communications', '/families', '/settings'] as const

export type SupportModeRedirect = (typeof SUPPORT_MODE_REDIRECTS)[number]

export function isSupportModeRedirect(value: unknown): value is SupportModeRedirect {
  return typeof value === 'string' && (SUPPORT_MODE_REDIRECTS as readonly string[]).includes(value)
}

export const SUPPORT_MODE_REDIRECT_LABELS: Record<SupportModeRedirect, string> = {
  '/': 'Dashboard',
  '/communications': 'Communications',
  '/families': 'Families',
  '/settings': 'Settings',
}
