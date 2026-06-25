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
    const {
      Organization,
      Family,
      FamilyMember,
      LifecycleEvent,
      LifecycleEventPayment,
      PaymentPlan,
      YearlyCalculation,
    } = await import('./models')
    await Promise.all([
      LifecycleEventPayment.deleteMany({}),
      YearlyCalculation.deleteMany({}),
      LifecycleEvent.deleteMany({}),
      FamilyMember.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  it('projects fund balance with blended roster and historical weddings', async () => {
    const {
      Organization,
      Family,
      FamilyMember,
      LifecycleEvent,
      LifecycleEventPayment,
      PaymentPlan,
      YearlyCalculation,
    } = await import('./models')
    const { loadDuesRecommendation } = await import('./projections')

    orgId = new Types.ObjectId()
    planId = new Types.ObjectId()
    const barEventId = new Types.ObjectId()
    const wedEventId = new Types.ObjectId()

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
    await LifecycleEvent.create({
      _id: wedEventId,
      organizationId: orgId,
      type: 'wedding',
      name: 'Wedding',
      amount: 300,
    })
    await YearlyCalculation.create({
      organizationId: orgId,
      year: 2025,
      calculatedIncome: 50_000,
      calculatedExpenses: 30_000,
      balance: 20_000,
    })
    const family = await Family.create({
      organizationId: orgId,
      name: 'Alpha',
      weddingDate: new Date('2018-01-01'),
      paymentPlanId: planId,
    })
    await LifecycleEventPayment.create({
      organizationId: orgId,
      familyId: family._id,
      eventType: 'wedding',
      amount: 300,
      year: 2025,
      eventDate: new Date('2025-06-01'),
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
    expect(out.openingFundBalance).toBe(20_000)
    expect(out.expenseSource).toBe('blended')
    expect(out.perEvent.find((e) => e.type === 'wedding')?.historicalAvgPerYear).toBeGreaterThan(0)
    expect(out.multiYear[0].projectedExpenses).toBeGreaterThan(0)
    expect(out.multiYear[0].closingFundBalance).toBeDefined()
    expect(out.multiYear[0].closingFundBalance).toBe(
      out.openingFundBalance +
        out.multiYear[0].projectedPlanIncome -
        out.multiYear[0].projectedExpenses,
    )
  })
})
