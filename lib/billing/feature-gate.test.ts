import { describe, it, expect, afterEach } from 'vitest'
import {
  assertCanAddFamily,
  assertCanChargeMembers,
  hasActiveSubscription,
  isBillingEnforced,
} from '@/lib/billing/feature-gate'

describe('billing feature gate', () => {
  const prevStripeKey = process.env.STRIPE_SECRET_KEY
  const prevStarterPrice = process.env.STRIPE_PRICE_STARTER

  afterEach(() => {
    if (prevStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = prevStripeKey
    if (prevStarterPrice === undefined) delete process.env.STRIPE_PRICE_STARTER
    else process.env.STRIPE_PRICE_STARTER = prevStarterPrice
  })

  it('treats active and trialing as subscribed', () => {
    expect(hasActiveSubscription({ subscriptionStatus: 'active' })).toBe(true)
    expect(hasActiveSubscription({ subscriptionStatus: 'trialing' })).toBe(true)
    expect(hasActiveSubscription({ subscriptionStatus: 'canceled' })).toBe(false)
    expect(hasActiveSubscription({ subscriptionStatus: null })).toBe(false)
  })

  it('skips enforcement when Stripe is not configured', () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(isBillingEnforced()).toBe(false)
    expect(assertCanChargeMembers({ subscriptionStatus: null }).ok).toBe(true)
    expect(assertCanAddFamily({ subscriptionStatus: null, planTier: 'starter' }, 999).ok).toBe(true)
  })

  it('blocks member charges without active subscription when enforced', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_PRICE_STARTER = 'price_starter_test'
    const result = assertCanChargeMembers({ subscriptionStatus: 'canceled' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(402)
      expect(result.error).toMatch(/active Kasa platform subscription/i)
    }
  })

  it('caps families by plan tier when enforced', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_PRICE_STARTER = 'price_starter_test'

    const atCap = assertCanAddFamily(
      { subscriptionStatus: 'active', planTier: 'starter' },
      75,
    )
    expect(atCap.ok).toBe(false)
    if (!atCap.ok) expect(atCap.status).toBe(403)

    const underCap = assertCanAddFamily(
      { subscriptionStatus: 'active', planTier: 'starter' },
      74,
    )
    expect(underCap.ok).toBe(true)

    const institution = assertCanAddFamily(
      { subscriptionStatus: 'active', planTier: 'institution' },
      10_000,
    )
    expect(institution.ok).toBe(true)
  })
})
