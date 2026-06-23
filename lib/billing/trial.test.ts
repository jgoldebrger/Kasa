import { describe, it, expect, afterEach } from 'vitest'
import {
  getSubscriptionTrialDays,
  isSubscriptionTrialEligible,
  resolveCheckoutTrialDays,
} from '@/lib/billing/trial'

describe('subscription trial', () => {
  const prev = process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS

  afterEach(() => {
    if (prev === undefined) delete process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS
    else process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS = prev
  })

  it('reads trial days from env', () => {
    delete process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS
    expect(getSubscriptionTrialDays()).toBe(0)

    process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS = '14'
    expect(getSubscriptionTrialDays()).toBe(14)

    process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS = '0'
    expect(getSubscriptionTrialDays()).toBe(0)
  })

  it('allows trial only for orgs without a prior subscription', () => {
    expect(isSubscriptionTrialEligible({})).toBe(true)
    expect(isSubscriptionTrialEligible({ subscriptionStatus: 'canceled' })).toBe(false)
    expect(isSubscriptionTrialEligible({ subscriptionId: 'sub_123' })).toBe(false)
  })

  it('applies trial days at checkout when configured and eligible', () => {
    process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS = '14'
    expect(resolveCheckoutTrialDays({})).toBe(14)
    expect(resolveCheckoutTrialDays({ subscriptionStatus: 'canceled' })).toBeUndefined()
  })
})
