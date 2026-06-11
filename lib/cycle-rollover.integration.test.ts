import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import mongoose from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('cycle-rollover (integration)', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, CycleConfig, CycleCharge, Family, PaymentPlan } =
      await import('./models')
    await Promise.all([
      CycleCharge.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      CycleConfig.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedOrgWithFamilies() {
    const { Organization, CycleConfig, PaymentPlan, Family } = await import('./models')
    const ownerId = new mongoose.Types.ObjectId()
    const org = await Organization.create({
      name: 'Rollover Test Org',
      slug: `rollover-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
    })
    const orgId = String(org._id)

    await CycleConfig.create({
      organizationId: org._id,
      cycleCalendar: 'gregorian',
      cycleStartMonth: 7,
      cycleStartDay: 1,
      isActive: true,
    })

    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    const freePlan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Complimentary',
      planNumber: 2,
      yearlyPrice: 0,
    })

    const wedding = new Date('2010-01-01')
    const withPlan = await Family.create({
      organizationId: org._id,
      name: 'Cohen',
      weddingDate: wedding,
      paymentPlanId: plan._id,
    })
    const noPlan = await Family.create({
      organizationId: org._id,
      name: 'Levy',
      weddingDate: wedding,
    })
    const zeroPlan = await Family.create({
      organizationId: org._id,
      name: 'Gold',
      weddingDate: wedding,
      paymentPlanId: freePlan._id,
    })

    return { orgId, org, plan, withPlan, noPlan, zeroPlan }
  }

  it('creates CycleCharge rows for families with a priced plan', async () => {
    const { orgId, withPlan } = await seedOrgWithFamilies()
    const { runCycleRolloverForOrg } = await import('./cycle-rollover')
    const { CycleCharge } = await import('./models')

    const chargeDate = new Date('2024-07-01T12:00:00.000Z')
    const result = await runCycleRolloverForOrg(orgId, chargeDate)

    expect(result.calendar).toBe('gregorian')
    expect(result.cycleYear).toBe(2023)
    expect(result.charged).toBe(1)
    expect(result.noPlan).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)

    const charges = await CycleCharge.find({
      organizationId: orgId,
      familyId: withPlan._id,
    }).lean()
    expect(charges).toHaveLength(1)
    expect(charges[0].amount).toBe(500)
    expect(charges[0].cycleYear).toBe(2023)
  })

  it('skips duplicate charges on a second run (E11000 idempotency)', async () => {
    const { orgId } = await seedOrgWithFamilies()
    const { runCycleRolloverForOrg } = await import('./cycle-rollover')
    const chargeDate = new Date('2024-07-01T12:00:00.000Z')

    const first = await runCycleRolloverForOrg(orgId, chargeDate)
    expect(first.charged).toBeGreaterThanOrEqual(1)

    const second = await runCycleRolloverForOrg(orgId, chargeDate)
    expect(second.charged).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(1)

    const { CycleCharge } = await import('./models')
    const chargeCount = await CycleCharge.countDocuments({ organizationId: orgId })
    expect(chargeCount).toBe(1)
  })

  it('uses hebrew calendar from active CycleConfig', async () => {
    const { orgId } = await seedOrgWithFamilies()
    const { CycleConfig } = await import('./models')
    await CycleConfig.updateOne(
      { organizationId: orgId },
      { cycleCalendar: 'hebrew' },
    )

    const { runCycleRolloverForOrg } = await import('./cycle-rollover')
    const chargeDate = new Date('2024-09-01T12:00:00.000Z')
    const result = await runCycleRolloverForOrg(orgId, chargeDate)

    expect(result.calendar).toBe('hebrew')
    expect(result.cycleYear).toBeGreaterThan(5700)
  })

  it('records errors when CycleCharge.create fails with a non-duplicate error', async () => {
    const { orgId } = await seedOrgWithFamilies()
    const { CycleCharge } = await import('./models')
    const createSpy = vi
      .spyOn(CycleCharge, 'create')
      .mockRejectedValueOnce(new Error('write concern timeout'))

    const { runCycleRolloverForOrg } = await import('./cycle-rollover')
    const chargeDate = new Date('2024-07-01T12:00:00.000Z')
    const result = await runCycleRolloverForOrg(orgId, chargeDate)

    expect(result.charged).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('write concern timeout')
    createSpy.mockRestore()
  })

  it('records per-family errors when plan lookup throws', async () => {
    const { orgId, withPlan } = await seedOrgWithFamilies()
    const { PaymentPlan } = await import('./models')
    const findSpy = vi
      .spyOn(PaymentPlan, 'findOne')
      .mockImplementationOnce(() => {
        throw new Error('plan lookup failed')
      })

    const { runCycleRolloverForOrg } = await import('./cycle-rollover')
    const chargeDate = new Date('2024-07-01T12:00:00.000Z')
    const result = await runCycleRolloverForOrg(orgId, chargeDate)

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          familyId: String(withPlan._id),
          error: 'plan lookup failed',
        }),
      ]),
    )
    findSpy.mockRestore()
  })

  it('stringifies non-Error throws in the outer family loop', async () => {
    const { orgId, withPlan } = await seedOrgWithFamilies()
    const { PaymentPlan } = await import('./models')
    const findSpy = vi.spyOn(PaymentPlan, 'findOne').mockImplementationOnce(() => {
      throw 'plain string failure'
    })

    const { runCycleRolloverForOrg } = await import('./cycle-rollover')
    const result = await runCycleRolloverForOrg(orgId, new Date('2024-07-01T12:00:00.000Z'))

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          familyId: String(withPlan._id),
          error: 'plain string failure',
        }),
      ]),
    )
    findSpy.mockRestore()
  })
})
