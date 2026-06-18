import { describe, expect, it } from 'vitest'
import { findPlanById, getPlanDisplayName, normalizePlanId } from './payment-plan-display'

describe('payment-plan-display', () => {
  const plans = [
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Plan A', planNumber: 1 },
    { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Plan B', planNumber: 2 },
  ]

  it('normalizes object ids to strings', () => {
    expect(normalizePlanId({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' })).toBe('aaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('finds plans with mixed id shapes', () => {
    expect(findPlanById(plans, { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' })?.name).toBe('Plan B')
  })

  it('falls back to legacy currentPlan when plan id lookup fails', () => {
    expect(getPlanDisplayName(plans, 'cccccccccccccccccccccccc', 1)).toBe('Plan A')
  })

  it('prefers paymentPlanId over currentPlan', () => {
    expect(getPlanDisplayName(plans, 'bbbbbbbbbbbbbbbbbbbbbbbb', 1)).toBe('Plan B')
  })
})
