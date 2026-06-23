import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createImpersonationToken,
  verifyImpersonationToken,
} from '@/lib/platform-impersonation-token'

describe('platform impersonation tokens', () => {
  const prevSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret-for-impersonation-tokens-32b'
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = prevSecret
  })

  it('round-trips a valid token for the same user', () => {
    const token = createImpersonationToken('user-1', 'org-1')
    expect(token).toBeTruthy()
    expect(verifyImpersonationToken(token!, 'user-1')).toBe('org-1')
  })

  it('rejects token for a different user', () => {
    const token = createImpersonationToken('user-1', 'org-1')
    expect(verifyImpersonationToken(token!, 'user-2')).toBeNull()
  })

  it('rejects tampered tokens', () => {
    const token = createImpersonationToken('user-1', 'org-1')!
    expect(verifyImpersonationToken(`${token}x`, 'user-1')).toBeNull()
  })
})
