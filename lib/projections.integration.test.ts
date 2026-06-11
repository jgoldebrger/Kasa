import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('loadDuesRecommendation (integration)', () => {
  const ownerId = new Types.ObjectId()
  let orgId: Types.ObjectId

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, Family, FamilyMember, LifecycleEvent, YearlyCalculation, PaymentPlan } =
      await import('./models')
    await Promise.all([
      YearlyCalculation.deleteMany({}),
      LifecycleEvent.deleteMany({}),
      FamilyMember.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  it('loads lifecycle events, aggregates, and history from Mongo', async () => {
    const { Organization, Family, FamilyMember, LifecycleEvent, YearlyCalculation } =
      await import('./models')
    const { loadDuesRecommendation } = await import('./projections')

    orgId = new Types.ObjectId()
    await Organization.create({
      _id: orgId,
      name: 'Projection Org',
      slug: `proj-${orgId.toString().slice(-8)}`,
      ownerId,
      timezone: 'UTC',
      barMitzvahAutoAssignPlanId: null,
    })
    await LifecycleEvent.create({
      organizationId: orgId,
      type: 'wedding',
      name: 'Wedding',
      amount: 250,
    })
    await Family.create({
      organizationId: orgId,
      name: 'Alpha',
      weddingDate: new Date('2018-01-01'),
    })
    await Family.create({
      organizationId: orgId,
      name: 'Beta',
      weddingDate: new Date('2024-03-01'),
      createdAt: new Date('2024-03-01'),
    })
    await FamilyMember.create({
      organizationId: orgId,
      familyId: (await Family.findOne({ organizationId: orgId, name: 'Alpha' }))!._id,
      firstName: 'Ben',
      lastName: 'Alpha',
      gender: 'male',
      barMitzvahDate: new Date('2023-06-01'),
      paymentPlanId: new Types.ObjectId(),
    })
    await YearlyCalculation.insertMany([
      {
        organizationId: orgId,
        year: 2022,
        byEvent: [{ type: 'wedding', count: 1, amount: 100 }],
        byPlan: [],
        calculatedIncome: 0,
        calculatedExpenses: 0,
        balance: 0,
        totalPayments: 0,
        planIncome: 0,
        totalIncome: 0,
        totalExpenses: 0,
      },
      {
        organizationId: orgId,
        year: 2023,
        byEvent: [{ type: 'wedding', count: 2, amount: 200 }],
        byPlan: [],
        calculatedIncome: 0,
        calculatedExpenses: 0,
        balance: 0,
        totalPayments: 0,
        planIncome: 0,
        totalIncome: 0,
        totalExpenses: 0,
      },
      {
        organizationId: orgId,
        year: 2024,
        byEvent: [{ type: 'wedding', count: 2, amount: 500 }],
        byPlan: [],
        calculatedIncome: 0,
        calculatedExpenses: 0,
        balance: 0,
        totalPayments: 0,
        planIncome: 0,
        totalIncome: 0,
        totalExpenses: 0,
      },
    ])

    const out = await loadDuesRecommendation(orgId.toString(), 5, 3, 2030)

    expect(out.currentFamilies).toBe(2)
    expect(out.perEvent).toHaveLength(1)
    expect(out.perEvent[0].type).toBe('wedding')
    expect(out.historyYearsSeen).toBeGreaterThanOrEqual(0)
    expect(out.multiYear.length).toBeGreaterThan(0)
  })
})
