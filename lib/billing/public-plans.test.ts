import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('loadPublicPlans', () => {
  const prevStarter = process.env.STRIPE_PRICE_STARTER
  const prevCommunity = process.env.STRIPE_PRICE_COMMUNITY
  const prevSecret = process.env.STRIPE_SECRET_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (prevStarter === undefined) delete process.env.STRIPE_PRICE_STARTER
    else process.env.STRIPE_PRICE_STARTER = prevStarter
    if (prevCommunity === undefined) delete process.env.STRIPE_PRICE_COMMUNITY
    else process.env.STRIPE_PRICE_COMMUNITY = prevCommunity
    if (prevSecret === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = prevSecret
    vi.restoreAllMocks()
  })

  it('marks purchasable tiers unavailable when Stripe prices are not configured', async () => {
    delete process.env.STRIPE_PRICE_STARTER
    delete process.env.STRIPE_PRICE_COMMUNITY
    delete process.env.STRIPE_SECRET_KEY

    const { loadPublicPlans } = await import('@/lib/billing/public-plans')
    const plans = await loadPublicPlans()

    const starter = plans.find((p) => p.tier === 'starter')
    const community = plans.find((p) => p.tier === 'community')
    const institution = plans.find((p) => p.tier === 'institution')

    expect(starter?.available).toBe(false)
    expect(community?.available).toBe(false)
    expect(institution?.available).toBe(true)
    expect(institution?.priceLabel).toBe('Custom')
  })

  it('loads live price labels from Stripe when configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_plans'
    process.env.STRIPE_PRICE_STARTER = 'price_starter_live'
    process.env.STRIPE_PRICE_COMMUNITY = 'price_community_live'

    vi.doMock('stripe', () => ({
      default: vi.fn(function Stripe() {
        return {
          prices: {
            retrieve: vi.fn(async (id: string) => {
              if (id === 'price_starter_live') {
                return {
                  id,
                  active: true,
                  currency: 'usd',
                  unit_amount: 4900,
                  recurring: { interval: 'month' },
                  product: { name: 'Kasa Starter' },
                }
              }
              return {
                id,
                active: true,
                currency: 'usd',
                unit_amount: 14900,
                recurring: { interval: 'month' },
                product: { name: 'Kasa Community' },
              }
            }),
          },
        }
      }),
    }))

    const { loadPublicPlans } = await import('@/lib/billing/public-plans')
    const plans = await loadPublicPlans()

    const starter = plans.find((p) => p.tier === 'starter')
    const community = plans.find((p) => p.tier === 'community')

    expect(starter?.available).toBe(true)
    expect(starter?.name).toBe('Kasa Starter')
    expect(starter?.priceLabel).toMatch(/\$49/)
    expect(community?.available).toBe(true)
    expect(community?.priceLabel).toMatch(/\$149/)
  })
})
