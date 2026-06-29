import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createImpersonationToken,
  verifyImpersonationToken,
  readImpersonationDetails,
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

  it('round-trips readOnly flag when set', () => {
    const token = createImpersonationToken('user-1', 'org-1', true)
    expect(token).toBeTruthy()
    const details = readImpersonationDetails(token!, 'user-1')
    expect(details).toMatchObject({ orgId: 'org-1', readOnly: true, scope: 'full' })
    expect(typeof details?.expiresAt).toBe('number')
  })

  it('round-trips scope when set', () => {
    const token = createImpersonationToken('user-1', 'org-1', false, 'communications')
    const details = readImpersonationDetails(token!, 'user-1')
    expect(details?.scope).toBe('communications')
  })

  it('defaults readOnly to false and scope to full when omitted', () => {
    const token = createImpersonationToken('user-1', 'org-1')
    const details = readImpersonationDetails(token!, 'user-1')
    expect(details?.readOnly).toBe(false)
    expect(details?.scope).toBe('full')
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
