import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { setupMongo, teardownMongo } from '../test/mongo-memory'

let netMembershipPaymentAmount: typeof import('./queries').netMembershipPaymentAmount
let membershipDuesYearFilter: typeof import('./queries').membershipDuesYearFilter

beforeAll(async () => {
  await setupMongo()
  ;({ netMembershipPaymentAmount, membershipDuesYearFilter } = await import('./queries'))
})

afterAll(async () => {
  await teardownMongo()
})

describe('netMembershipPaymentAmount', () => {
  it('returns gross amount when there is no refund', () => {
    expect(netMembershipPaymentAmount({ amount: 200, refundedAmount: 0 })).toBe(200)
  })

  it('nets partial refunds', () => {
    expect(netMembershipPaymentAmount({ amount: 200, refundedAmount: 50 })).toBe(150)
  })

  it('never returns negative when refund exceeds amount', () => {
    expect(netMembershipPaymentAmount({ amount: 40, refundedAmount: 100 })).toBe(0)
  })
})

describe('membershipDuesYearFilter (integration)', () => {
  afterEach(async () => {
    const { Organization } = await import('../models')
    await Organization.deleteMany({})
  })

  it('builds a membership filter scoped to the org timezone', async () => {
    const { Organization } = await import('../models')

    const ownerId = new mongoose.Types.ObjectId()
    const org = await Organization.create({
      name: 'Tax Org',
      slug: `tax-${Date.now()}`,
      ownerId,
      timezone: 'America/New_York',
    })
    const orgId = String(org._id)

    const filter = await membershipDuesYearFilter(2024, orgId)

    expect(filter.type).toBe('membership')
    expect(filter.deletedAt).toBeNull()
    expect(String(filter.organizationId)).toBe(orgId)
    expect(filter.$or).toBeDefined()
    expect(Array.isArray(filter.$or)).toBe(true)
  })

  it('merges extra predicates into the filter', async () => {
    const { Organization } = await import('../models')

    const ownerId = new mongoose.Types.ObjectId()
    const org = await Organization.create({
      name: 'Tax Org 2',
      slug: `tax2-${Date.now()}`,
      ownerId,
    })
    const filter = await membershipDuesYearFilter(2023, String(org._id), {
      familyId: new mongoose.Types.ObjectId(),
    })

    expect((filter as { familyId?: unknown }).familyId).toBeDefined()
    expect(filter.type).toBe('membership')
  })
})
