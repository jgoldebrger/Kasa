import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('wedding-converter (integration)', () => {
  let orgId: Types.ObjectId
  let planId: Types.ObjectId
  let parentFamilyId: Types.ObjectId
  const ownerId = new Types.ObjectId()

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, Family, FamilyMember, PaymentPlan } = await import('./models')
    await Promise.all([
      FamilyMember.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedOrg(opts?: { defaultPlan?: boolean }) {
    const { Organization, PaymentPlan, Family } = await import('./models')

    orgId = new Types.ObjectId()
    planId = new Types.ObjectId()
    parentFamilyId = new Types.ObjectId()

    await Organization.create({
      _id: orgId,
      name: 'Wedding Org',
      slug: `wed-${orgId.toString().slice(-6)}`,
      ownerId,
      timezone: 'UTC',
      ...(opts?.defaultPlan !== false
        ? { weddingConversionDefaultPlanId: planId }
        : {}),
    })

    if (opts?.defaultPlan !== false) {
      await PaymentPlan.create({
        _id: planId,
        organizationId: orgId,
        name: 'Newlywed',
        planNumber: 2,
        yearlyPrice: 400,
      })
    }

    await Family.create({
      _id: parentFamilyId,
      organizationId: orgId,
      name: 'Parent Family',
      weddingDate: new Date('2000-01-01'),
      husbandHebrewName: 'אב',
      wifeHebrewName: 'אם',
    })
  }

  it('converts a member with past wedding date into a new family', async () => {
    const { FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg()
    await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Yosef',
      lastName: 'Cohen',
      gender: 'male',
      weddingDate: new Date('2020-06-01'),
      spouseFirstName: 'Sarah',
      spouseLastName: 'Levi',
    })

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(1)

    const { Family } = await import('./models')
    const newFamilies = await Family.find({
      organizationId: orgId,
      parentFamilyId,
    }).lean()
    expect(newFamilies).toHaveLength(1)
    expect(newFamilies[0].name).toContain('Yosef')
    expect(String(newFamilies[0].paymentPlanId)).toBe(planId.toString())

    const remaining = await FamilyMember.find({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Yosef',
    })
    expect(remaining).toHaveLength(0)
  })

  it('converts a female member using wife fields on the new family', async () => {
    const { Family, FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg()
    await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Rivka',
      lastName: 'Gold',
      hebrewFirstName: 'רבקה',
      gender: 'female',
      weddingDate: new Date('2019-03-15'),
      spouseFirstName: 'David',
      spouseLastName: 'Gold',
      spouseHebrewName: 'דוד',
    })

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(1)

    const newFamily = await Family.findOne({
      organizationId: orgId,
      parentFamilyId,
    }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(newFamily).toBeTruthy()
    expect(newFamily!.wifeFirstName).toBe('Rivka')
    expect(newFamily!.wifeHebrewName).toBe('רבקה')
    expect(newFamily!.wifeFatherHebrewName).toBe('אם')
    expect(newFamily!.husbandFirstName).toBe('David')
    expect(newFamily!.husbandHebrewName).toBe('דוד')
  })

  it('releases claim when the original family is missing', async () => {
    const { FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg({ defaultPlan: false })
    const orphanFamilyId = new Types.ObjectId()
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: orphanFamilyId,
      firstName: 'Orphan',
      lastName: 'Member',
      gender: 'male',
      weddingDate: new Date('2018-01-01'),
    })

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(0)

    const after = await FamilyMember.findById(member._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(after).toBeTruthy()
    expect(after!.convertedToFamily).not.toBe(true)
  })

  it('releases claim when the claimed member row has no wedding date', async () => {
    const { FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg()
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Claimed',
      lastName: 'NoWed',
      gender: 'male',
      weddingDate: new Date('2020-01-01'),
    })

    const claimSpy = vi.spyOn(FamilyMember, 'findOneAndUpdate').mockResolvedValueOnce({
      ...member.toObject(),
      weddingDate: null,
    } as never)

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(0)

    const after = await FamilyMember.findById(member._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(after?.convertedToFamily).not.toBe(true)

    claimSpy.mockRestore()
  })

  it('releases claim when member has no wedding date', async () => {
    const { FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg({ defaultPlan: false })
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'NoDate',
      lastName: 'Member',
      gender: 'male',
      weddingDate: null,
    })

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(0)

    const after = await FamilyMember.findById(member._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(after).toBeTruthy()
    expect(after!.convertedToFamily).not.toBe(true)
  })

  it('releases the claim when family creation fails', async () => {
    const { Family, FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg()
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Fail',
      lastName: 'Create',
      gender: 'male',
      weddingDate: new Date('2020-01-01'),
      spouseFirstName: 'Rivka',
    })

    const createSpy = vi.spyOn(Family, 'create').mockRejectedValueOnce(new Error('create failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(0)

    const after = await FamilyMember.findById(member._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(after?.convertedToFamily).not.toBe(true)

    createSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('creates a spouse member row for female members', async () => {
    const { Family, FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg()
    await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Sarah',
      lastName: 'Cohen',
      gender: 'female',
      weddingDate: new Date('2020-01-01'),
      spouseFirstName: 'David',
      spouseLastName: 'Levi',
    })

    const { converted } = await convertMembersOnWeddingDate(orgId.toString())
    expect(converted).toBe(1)

    const newFamily = await Family.findOne({ organizationId: orgId, parentFamilyId }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(newFamily?.name).toMatch(/Sarah Cohen & David Cohen/)

    const spouse = await FamilyMember.findOne({
      organizationId: orgId,
      familyId: newFamily?._id,
      firstName: 'David',
    }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(spouse?.gender).toBe('male')
  })

  it('rethrows when connectDB fails', async () => {
    vi.resetModules()
    vi.doMock('./database', () => ({
      default: vi.fn().mockRejectedValue(new Error('db down')),
    }))
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')
    await expect(convertMembersOnWeddingDate(orgId.toString())).rejects.toThrow('db down')
    vi.doUnmock('./database')
    vi.resetModules()
  })

  it('skips duplicate claim when conversion runs overlap', async () => {
    const { Family, FamilyMember } = await import('./models')
    const { convertMembersOnWeddingDate } = await import('./wedding-converter')

    await seedOrg()
    await FamilyMember.create({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Claimed',
      lastName: 'Once',
      gender: 'male',
      weddingDate: new Date('2020-01-01'),
      spouseFirstName: 'Miriam',
    })

    const [first, second] = await Promise.all([
      convertMembersOnWeddingDate(orgId.toString()),
      convertMembersOnWeddingDate(orgId.toString()),
    ])

    expect(first.converted + second.converted).toBe(1)

    const newFamilies = await Family.find({ organizationId: orgId, parentFamilyId }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(newFamilies).toHaveLength(1)

    const remaining = await FamilyMember.find({
      organizationId: orgId,
      familyId: parentFamilyId,
      firstName: 'Claimed',
    })
    expect(remaining).toHaveLength(0)
  })
})
