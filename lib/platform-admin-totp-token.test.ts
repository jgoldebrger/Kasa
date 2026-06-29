import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PLATFORM_ADMIN_TOTP_MAX_AGE_SEC,
  createPlatformAdminTotpToken,
  isPlatformAdminTotpTokenValid,
  readPlatformAdminTotpVerifiedAt,
} from './platform-admin-totp-token'

describe('platform-admin-totp-token', () => {
  const prevSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-platform-admin-totp-secret'
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = prevSecret
  })

  it('mints and validates a token for the same user', () => {
    const token = createPlatformAdminTotpToken('user-1')
    expect(token).toBeTruthy()
    expect(isPlatformAdminTotpTokenValid(token!, 'user-1')).toBe(true)
    const verifiedAt = readPlatformAdminTotpVerifiedAt(token!, 'user-1')
    expect(verifiedAt).toBeGreaterThan(0)
  })

  it('rejects tokens for a different user', () => {
    const token = createPlatformAdminTotpToken('user-1')
    expect(isPlatformAdminTotpTokenValid(token!, 'user-2')).toBe(false)
  })

  it('rejects expired tokens', () => {
    const token = createPlatformAdminTotpToken('user-1')
    const realNow = Date.now
    Date.now = () => realNow() + (PLATFORM_ADMIN_TOTP_MAX_AGE_SEC + 1) * 1000
    try {
      expect(isPlatformAdminTotpTokenValid(token!, 'user-1')).toBe(false)
    } finally {
      Date.now = realNow
    }
  })
})
