/**
 * Cookie / privacy notice helpers. Session cookies are strictly necessary
 * for authentication and workspace selection — we only record that the
 * user has seen the notice, not marketing consent.
 */

export const COOKIE_CONSENT_STORAGE_KEY = 'kasa-cookie-consent'

export interface SessionCookieInfo {
  name: string
  purpose: string
  duration: string
  type: 'strictly-necessary'
}

/** Cookies set by Kasa for authentication, workspace, and locale. */
export const SESSION_COOKIES: readonly SessionCookieInfo[] = [
  {
    name: 'authjs.session-token',
    purpose:
      'Maintains your signed-in session (Auth.js). In production over HTTPS this may appear as __Secure-authjs.session-token.',
    duration: 'Up to 7 days (refreshed while you use the app)',
    type: 'strictly-necessary',
  },
  {
    name: 'kasa_active_org',
    purpose: 'Remembers which workspace (organization) you last selected.',
    duration: 'Session',
    type: 'strictly-necessary',
  },
  {
    name: 'kasa-locale',
    purpose: 'Stores your language preference for server-rendered pages.',
    duration: 'Up to 1 year',
    type: 'strictly-necessary',
  },
] as const

export function hasAcceptedCookieNotice(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) === 'accepted'
  } catch {
    return true
  }
}

export function shouldShowCookieNotice(): boolean {
  return !hasAcceptedCookieNotice()
}

export function acceptCookieNotice(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'accepted')
  } catch {
    /* localStorage may be blocked — fail quietly */
  }
}
