import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('loadDuesRecommendation (integration)', () => {
  const ownerId = new Types.ObjectId()
  let orgId: Types.ObjectId
  let planId: Types.ObjectId

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, Family, FamilyMember, LifecycleEvent, PaymentPlan } =
      await import('./models')
    await Promise.all([
      LifecycleEvent.deleteMany({}),
      FamilyMember.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  it('projects expenses from roster dates and scales payment plans', async () => {
    const { Organization, Family, FamilyMember, LifecycleEvent, PaymentPlan } =
      await import('./models')
    const { loadDuesRecommendation } = await import('./projections')

    orgId = new Types.ObjectId()
    planId = new Types.ObjectId()
    const barEventId = new Types.ObjectId()

    await Organization.create({
      _id: orgId,
      name: 'Projection Org',
      slug: `proj-${orgId.toString().slice(-8)}`,
      ownerId,
      timezone: 'UTC',
      barMitzvahAutoAssignPlanId: null,
      barMitzvahAutoCreateEventTypeId: barEventId,
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 1000,
    })
    await LifecycleEvent.create({
      _id: barEventId,
      organizationId: orgId,
      type: 'barmitzvah',
      name: 'Bar Mitzvah',
      amount: 500,
    })
    const family = await Family.create({
      organizationId: orgId,
      name: 'Alpha',
      weddingDate: new Date('2018-01-01'),
      paymentPlanId: planId,
    })
    await FamilyMember.create({
      organizationId: orgId,
      familyId: family._id,
      firstName: 'Ben',
      lastName: 'Alpha',
      gender: 'male',
      barMitzvahDate: new Date('2030-06-01'),
    })

    const out = await loadDuesRecommendation(orgId.toString(), 5, 3, 2030)

    expect(out.currentFamilies).toBe(1)
    expect(out.currentPlanIncome).toBe(1000)
    expect(out.plans).toHaveLength(1)
    expect(out.perEvent).toHaveLength(1)
    expect(out.perEvent[0].type).toBe('barmitzvah')
    expect(out.perEvent[0].rosterMapped).toBe(true)
    expect(out.expenseSource).toBe('roster')
    expect(out.multiYear[0].projectedExpenses).toBe(500)
    expect(out.multiYear[0].scaleFactor).toBeCloseTo(0.5, 6)
    expect(out.multiYear[0].planRecommendations[0].recommendedPrice).toBeCloseTo(500, 6)
    expect(out.multiYear.length).toBe(3)
  })
})
