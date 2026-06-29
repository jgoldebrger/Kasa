import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { blockScopedSupportAccess } from './support-mode-scope'
import type { OrgContext } from '@/lib/auth-helpers'

function req(method: string, path: string) {
  return new NextRequest(new URL(`http://localhost${path}`), { method })
}

const impersonationCtx = (scope: 'full' | 'communications' | 'billing') =>
  ({
    isPlatformImpersonation: true,
    supportModeScope: scope,
  }) as OrgContext

describe('blockScopedSupportAccess', () => {
  it('allows any route for full scope', () => {
    expect(
      blockScopedSupportAccess(req('GET', '/api/billing/sync'), impersonationCtx('full')),
    ).toBeNull()
    expect(blockScopedSupportAccess(req('GET', '/api/emails'), impersonationCtx('full'))).toBeNull()
  })

  it('blocks billing APIs in communications scope', () => {
    const res = blockScopedSupportAccess(
      req('GET', '/api/billing/portal'),
      impersonationCtx('communications'),
    )
    expect(res?.status).toBe(403)
  })

  it('blocks communications APIs in billing scope', () => {
    const res = blockScopedSupportAccess(
      req('POST', '/api/emails/send'),
      impersonationCtx('billing'),
    )
    expect(res?.status).toBe(403)
  })

  it('allows communications APIs in communications scope', () => {
    expect(
      blockScopedSupportAccess(
        req('GET', '/api/email-templates'),
        impersonationCtx('communications'),
      ),
    ).toBeNull()
  })

  it('allows billing APIs in billing scope', () => {
    expect(
      blockScopedSupportAccess(req('GET', '/api/billing/sync'), impersonationCtx('billing')),
    ).toBeNull()
  })

  it('allows shell APIs in any scoped session', () => {
    expect(
      blockScopedSupportAccess(
        req('GET', '/api/organizations/current'),
        impersonationCtx('billing'),
      ),
    ).toBeNull()
  })

  it('allows when not impersonating', () => {
    expect(blockScopedSupportAccess(req('GET', '/api/billing/sync'), {} as OrgContext)).toBeNull()
  })
})

describe('isCommunicationsApi / isBillingApi', () => {
  it('classifies known prefixes', async () => {
    const { isCommunicationsApi, isBillingApi } = await import('./support-mode-scope')
    expect(isCommunicationsApi('/api/email-templates/abc')).toBe(true)
    expect(isCommunicationsApi('/api/billing/sync')).toBe(false)
    expect(isBillingApi('/api/billing/checkout')).toBe(true)
    expect(isBillingApi('/api/emails')).toBe(false)
  })
})
