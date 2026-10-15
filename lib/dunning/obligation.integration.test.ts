import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

describe('obligationStartDate', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { CycleCharge, CycleConfig, Family, Organization } = await import('@/lib/models')
    await Promise.all([
      CycleCharge.deleteMany({}),
      Family.deleteMany({}),
      CycleConfig.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedOrgAndFamily(opts?: { timezone?: string }) {
    const { Organization, Family } = await import('@/lib/models')
    const ownerId = new Types.ObjectId()
    const org = await Organization.create({
      name: 'Obligation Org',
      slug: `obligation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId,
      timezone: opts?.timezone ?? 'UTC',
    })
    const family = await Family.create({
      organizationId: org._id,
      name: 'Cohen Family',
      weddingDate: new Date('2010-01-01'),
    })
    return { org, family }
  }

  it('returns the earliest CycleCharge.chargeDate', async () => {
    const { obligationStartDate } = await import('./obligation')
    const { CycleCharge } = await import('@/lib/models')
    const { org, family } = await seedOrgAndFamily()
    const later = new Date('2026-09-01T00:00:00.000Z')
    const earlier = new Date('2024-09-01T00:00:00.000Z')
    await CycleCharge.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 100,
      chargeDate: later,
      cycleYear: 2026,
      calendar: 'gregorian',
    })
    await CycleCharge.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 100,
      chargeDate: earlier,
      cycleYear: 2024,
      calendar: 'gregorian',
    })

    const start = await obligationStartDate({
      organizationId: String(org._id),
      familyId: String(family._id),
      familyCreatedAt: family.createdAt,
    })

    expect(start.getTime()).toBe(earlier.getTime())
  })

  it('uses current cycle start when there are no charges and config is September 1 UTC', async () => {
    const { obligationStartDate } = await import('./obligation')
    const { CycleConfig } = await import('@/lib/models')
    const { org, family } = await seedOrgAndFamily({ timezone: 'UTC' })
    await CycleConfig.create({
      organizationId: org._id,
      cycleCalendar: 'gregorian',
      cycleStartMonth: 9,
      cycleStartDay: 1,
      isActive: true,
    })

    const start = await obligationStartDate({
      organizationId: String(org._id),
      familyId: String(family._id),
      familyCreatedAt: family.createdAt,
      now: new Date('2026-10-01T12:00:00.000Z'),
    })

    expect(start.toISOString().startsWith('2026-09-01')).toBe(true)
  })

  it('returns family.createdAt when there is no cycle config', async () => {
    const { obligationStartDate } = await import('./obligation')
    const { org, family } = await seedOrgAndFamily()

    const start = await obligationStartDate({
      organizationId: String(org._id),
      familyId: String(family._id),
      familyCreatedAt: family.createdAt,
      now: new Date('2026-10-01T12:00:00.000Z'),
    })

    expect(start.getTime()).toBe(family.createdAt.getTime())
  })
})
