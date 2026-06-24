import { describe, it, expect, afterEach } from 'vitest'
import {
  assertPlatformAccountAccess,
  getPlatformAccessSnapshot,
  isSubscriptionExemptApi,
  isSubscriptionExemptPage,
  platformAccessRedirectPath,
} from '@/lib/billing/account-access'

describe('platform account access', () => {
  const prevStripeKey = process.env.STRIPE_SECRET_KEY
  const prevStarterPrice = process.env.STRIPE_PRICE_STARTER

  afterEach(() => {
    if (prevStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = prevStripeKey
    if (prevStarterPrice === undefined) delete process.env.STRIPE_PRICE_STARTER
    else process.env.STRIPE_PRICE_STARTER = prevStarterPrice
  })

  it('exempts pricing and setup but not the main app settings area', () => {
    expect(isSubscriptionExemptPage('/pricing')).toBe(true)
    expect(isSubscriptionExemptPage('/setup')).toBe(true)
    expect(isSubscriptionExemptPage('/settings')).toBe(false)
    expect(isSubscriptionExemptPage('/settings/members')).toBe(false)
    expect(isSubscriptionExemptPage('/')).toBe(false)
    expect(isSubscriptionExemptPage('/families')).toBe(false)
  })

  it('exempts billing, connect, and notification APIs', () => {
    expect(isSubscriptionExemptApi('/api/billing/checkout')).toBe(true)
    expect(isSubscriptionExemptApi('/api/organizations/current')).toBe(true)
    expect(isSubscriptionExemptApi('/api/organizations')).toBe(true)
    expect(isSubscriptionExemptApi('/api/stripe/connect/status')).toBe(true)
    expect(isSubscriptionExemptApi('/api/notifications')).toBe(true)
    expect(isSubscriptionExemptApi('/api/organizations/branding')).toBe(false)
    expect(isSubscriptionExemptApi('/api/families')).toBe(false)
  })

  it('redirects owners and members differently', () => {
    expect(platformAccessRedirectPath('owner')).toBe('/pricing?subscribe=required')
    expect(platformAccessRedirectPath('member')).toBe('/pricing?subscribe=required&contact=owner')
  })

  it('blocks workspace access without subscription when billing is enforced', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_PRICE_STARTER = 'price_starter_test'

    const blocked = assertPlatformAccountAccess({ subscriptionStatus: null })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.status).toBe(402)

    const allowed = assertPlatformAccountAccess({ subscriptionStatus: 'active' })
    expect(allowed.ok).toBe(true)

    const snapshot = getPlatformAccessSnapshot({ subscriptionStatus: null })
    expect(snapshot).toEqual({ required: true, active: false })
  })

  it('allows access when billing is not configured', () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PRICE_STARTER
    expect(assertPlatformAccountAccess({ subscriptionStatus: null }).ok).toBe(true)
    expect(getPlatformAccessSnapshot({ subscriptionStatus: null })).toEqual({
      required: false,
      active: true,
    })
  })
})
