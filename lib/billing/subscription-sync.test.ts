import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

describe('subscription sync', () => {
  const orgId = '507f1f77bcf86cd799439011'

  beforeEach(() => {
    vi.resetModules()
  })

  it('syncs subscription status from checkout session', async () => {
    const findByIdAndUpdate = vi.fn().mockResolvedValue({})
    const retrieveSession = vi.fn().mockResolvedValue({
      id: 'cs_test',
      customer: 'cus_1',
      subscription: {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'trialing',
        metadata: { organizationId: orgId, planTier: 'starter' },
        items: {
          data: [
            {
              price: { id: 'price_starter' },
              current_period_end: 1_700_000_000,
            },
          ],
        },
        trial_end: 1_699_000_000,
      },
      metadata: { organizationId: orgId, planTier: 'starter' },
    })

    vi.doMock('@/lib/models', () => ({
      Organization: {
        findById: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({
              stripeCustomerId: 'cus_1',
              subscriptionId: 'sub_1',
            }),
          }),
        }),
        findByIdAndUpdate,
        findOne: vi.fn(),
      },
    }))

    const stripe = {
      checkout: { sessions: { retrieve: retrieveSession } },
      subscriptions: { retrieve: vi.fn(), list: vi.fn() },
    } as unknown as Stripe

    const { syncBillingFromCheckoutSession } = await import('@/lib/billing/subscription-sync')
    const ok = await syncBillingFromCheckoutSession(orgId, 'cs_test', stripe)

    expect(ok).toBe(true)
    expect(findByIdAndUpdate).toHaveBeenCalled()
    const lastUpdate = findByIdAndUpdate.mock.calls.at(-1)?.[1]
    expect(lastUpdate?.subscriptionStatus).toBe('trialing')
    expect(lastUpdate?.planTier).toBe('starter')
  })
})
