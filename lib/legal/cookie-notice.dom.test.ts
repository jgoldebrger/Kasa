/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COOKIE_CONSENT_STORAGE_KEY,
  SESSION_COOKIES,
  acceptCookieNotice,
  hasAcceptedCookieNotice,
  shouldShowCookieNotice,
} from './cookie-notice'

describe('cookie-notice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('lists the three session cookies', () => {
    const names = SESSION_COOKIES.map((c) => c.name)
    expect(names).toContain('authjs.session-token')
    expect(names).toContain('kasa_active_org')
    expect(names).toContain('kasa-locale')
    expect(SESSION_COOKIES).toHaveLength(3)
  })

  it('shows notice when consent has not been recorded', () => {
    expect(hasAcceptedCookieNotice()).toBe(false)
    expect(shouldShowCookieNotice()).toBe(true)
  })

  it('hides notice after acceptance', () => {
    acceptCookieNotice()
    expect(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe('accepted')
    expect(hasAcceptedCookieNotice()).toBe(true)
    expect(shouldShowCookieNotice()).toBe(false)
  })
})
