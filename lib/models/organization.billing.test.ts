import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'
import { Organization } from '@/lib/models'

describe('Organization billing fields', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  it('persists platform subscription billing fields', async () => {
    const ownerId = new Types.ObjectId()
    const trialEndsAt = new Date('2026-07-01T00:00:00.000Z')
    const currentPeriodEnd = new Date('2026-08-01T00:00:00.000Z')

    const org = await Organization.create({
      name: 'Billing Test Org',
      slug: `billing-${Date.now()}`,
      ownerId,
      stripeCustomerId: 'cus_test_123',
      subscriptionId: 'sub_test_123',
      planTier: 'community',
      subscriptionStatus: 'active',
      trialEndsAt,
      currentPeriodEnd,
    })

    const loaded = await Organization.findById(org._id).lean<any>()
    expect(loaded?.stripeCustomerId).toBe('cus_test_123')
    expect(loaded?.subscriptionId).toBe('sub_test_123')
    expect(loaded?.planTier).toBe('community')
    expect(loaded?.subscriptionStatus).toBe('active')
    expect(new Date(loaded?.trialEndsAt).toISOString()).toBe(trialEndsAt.toISOString())
    expect(new Date(loaded?.currentPeriodEnd).toISOString()).toBe(currentPeriodEnd.toISOString())
  })

  it('defaults billing fields to null', async () => {
    const org = await Organization.create({
      name: 'Billing Defaults Org',
      slug: `billing-defaults-${Date.now()}`,
      ownerId: new Types.ObjectId(),
    })

    const loaded = await Organization.findById(org._id).lean<any>()
    expect(loaded?.stripeCustomerId).toBeNull()
    expect(loaded?.subscriptionId).toBeNull()
    expect(loaded?.planTier).toBeNull()
    expect(loaded?.subscriptionStatus).toBeNull()
    expect(loaded?.trialEndsAt).toBeNull()
    expect(loaded?.currentPeriodEnd).toBeNull()
  })
})
