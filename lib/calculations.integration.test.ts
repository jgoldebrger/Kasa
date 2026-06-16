import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('calculations (integration)', () => {
  let orgId: Types.ObjectId
  let planId: Types.ObjectId
  let familyId: Types.ObjectId
  let ownerId: Types.ObjectId

  beforeAll(async () => {
    await setupMongo()
    ownerId = new Types.ObjectId()
    orgId = new Types.ObjectId()
    planId = new Types.ObjectId()
    familyId = new Types.ObjectId()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const {
      Family,
      FamilyMember,
      PaymentPlan,
      Payment,
      Organization,
      LifecycleEvent,
      LifecycleEventPayment,
      YearlyCalculation,
    } = await import('./models')
    await Promise.all([
      YearlyCalculation.deleteMany({}),
      LifecycleEventPayment.deleteMany({}),
      LifecycleEvent.deleteMany({}),
      Payment.deleteMany({}),
      FamilyMember.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedFamilyWithPayments(opts?: {
    planYearlyPrice?: number
    payments?: Array<{ amount: number; refundedAmount?: number; paymentDate?: Date }>
  }) {
    const { Organization, PaymentPlan, Family, Payment } = await import('./models')
    const planYearlyPrice = opts?.planYearlyPrice ?? 500
    const asOf = new Date('2024-06-15T12:00:00.000Z')

    await Organization.create({
      _id: orgId,
      name: 'Test Org',
      slug: `test-org-${orgId.toString().slice(-6)}`,
      ownerId,
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: planYearlyPrice,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Cohen Family',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: planId,
    })

    for (const p of opts?.payments ?? [{ amount: 200, paymentDate: asOf }]) {
      await Payment.create({
        organizationId: orgId,
        familyId,
        amount: p.amount,
        refundedAmount: p.refundedAmount ?? 0,
        paymentDate: p.paymentDate ?? asOf,
        type: 'membership',
      })
    }

    return { asOf }
  }

  it('calculateFamilyBalance nets payments minus plan cost', async () => {
    const { calculateFamilyBalance } = await import('./calculations')
    const { asOf } = await seedFamilyWithPayments({
      planYearlyPrice: 500,
      payments: [{ amount: 200 }, { amount: 150.555 }],
    })

    const result = await calculateFamilyBalance(
      familyId.toString(),
      orgId.toString(),
      asOf,
    )

    expect(result.planCost).toBe(500)
    expect(result.totalPayments).toBe(350.56)
    expect(result.balance).toBe(-149.44)
  })

  it('calculateFamilyBalance subtracts partial refunds from payment totals', async () => {
    const { calculateFamilyBalance } = await import('./calculations')
    const { asOf } = await seedFamilyWithPayments({
      planYearlyPrice: 100,
      payments: [{ amount: 80, refundedAmount: 30 }],
    })

    const result = await calculateFamilyBalance(
      familyId.toString(),
      orgId.toString(),
      asOf,
    )

    expect(result.totalPayments).toBe(50)
    expect(result.balance).toBe(-50)
  })

  it('calculateFamilyBalance uses planCost 0 when family has no plan', async () => {
    const { calculateFamilyBalance } = await import('./calculations')
    const { Organization, Family, Payment } = await import('./models')
    const asOf = new Date('2024-06-15T12:00:00.000Z')

    await Organization.create({
      _id: orgId,
      name: 'No Plan Org',
      slug: `no-plan-${orgId.toString().slice(-6)}`,
      ownerId,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Unassigned Family',
      weddingDate: new Date('2010-01-01'),
    })
    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 75,
      paymentDate: asOf,
      type: 'membership',
    })

    const result = await calculateFamilyBalance(
      familyId.toString(),
      orgId.toString(),
      asOf,
    )

    expect(result.planCost).toBe(0)
    expect(result.totalPayments).toBe(75)
    expect(result.balance).toBe(75)
  })

  it('calculateFamilyBalance throws when family is missing', async () => {
    const { calculateFamilyBalance } = await import('./calculations')
    const { Organization } = await import('./models')

    await Organization.create({
      _id: orgId,
      name: 'Missing Family Org',
      slug: `missing-${orgId.toString().slice(-6)}`,
      ownerId,
    })

    await expect(
      calculateFamilyBalance(new Types.ObjectId().toString(), orgId.toString()),
    ).rejects.toThrow(/Family not found/)
  })

  async function seedYearlyFixtures() {
    const {
      Organization,
      PaymentPlan,
      Family,
      FamilyMember,
      Payment,
      LifecycleEvent,
      LifecycleEventPayment,
    } = await import('./models')
    const planBId = new Types.ObjectId()
    const familyBId = new Types.ObjectId()
    const memberId = new Types.ObjectId()
    const year = 2024

    await Organization.create({
      _id: orgId,
      name: 'Yearly Org',
      slug: `yearly-${orgId.toString().slice(-6)}`,
      ownerId,
      timezone: 'UTC',
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    await PaymentPlan.create({
      _id: planBId,
      organizationId: orgId,
      name: 'Premium',
      planNumber: 2,
      yearlyPrice: 800,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Cohen Family',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: planId,
    })
    await Family.create({
      _id: familyBId,
      organizationId: orgId,
      name: 'Levy Family',
      weddingDate: new Date('2012-01-01'),
      paymentPlanId: planBId,
    })
    await FamilyMember.create({
      _id: memberId,
      organizationId: orgId,
      familyId,
      firstName: 'Moshe',
      lastName: 'Cohen',
      paymentPlanId: planBId,
    })
    await FamilyMember.create({
      organizationId: orgId,
      familyId: familyBId,
      firstName: 'Sarah',
      lastName: 'Levy',
    })

    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 200,
      refundedAmount: 25,
      year,
      paymentDate: new Date('2024-06-01'),
      type: 'membership',
    })
    await Payment.create({
      organizationId: orgId,
      familyId: familyBId,
      amount: 100,
      paymentDate: new Date('2023-06-01'),
      type: 'donation',
    })

    await LifecycleEvent.create({
      organizationId: orgId,
      type: 'bar_mitzvah',
      name: 'Bar Mitzvah',
      amount: 50,
    })
    await LifecycleEventPayment.create({
      organizationId: orgId,
      familyId,
      eventType: 'bar_mitzvah',
      eventDate: new Date('2024-04-01'),
      amount: 120,
      year,
    })

    return { planBId, familyBId, memberId, year }
  }

  it('countMembersByPaymentPlan attributes families and members to plans', async () => {
    const { countMembersByPaymentPlan } = await import('./calculations')
    const { planBId, year } = await seedYearlyFixtures()

    const breakdown = await countMembersByPaymentPlan(year, orgId.toString())
    const standard = breakdown.find((p) => String(p.planId) === planId.toString())
    const premium = breakdown.find((p) => String(p.planId) === planBId.toString())

    expect(standard?.familyCount).toBe(1)
    expect(standard?.income).toBe(500)
    // Member override moves Moshe to premium for display counts only.
    expect(standard?.count).toBe(0)
    expect(premium?.familyCount).toBe(1)
    expect(premium?.income).toBe(800)
    expect(premium?.count).toBe(2)
  })

  it('calculateYearlyIncome sums plan income and net payments for the year', async () => {
    const { calculateYearlyIncome } = await import('./calculations')
    const { year } = await seedYearlyFixtures()

    const income = await calculateYearlyIncome(year, orgId.toString(), 50)

    expect(income.planIncome).toBe(1300)
    expect(income.totalPayments).toBe(175)
    expect(income.calculatedIncome).toBe(225)
    expect(income.extraDonation).toBe(50)
  })

  it('calculateYearlyExpenses aggregates lifecycle event payments', async () => {
    const { calculateYearlyExpenses } = await import('./calculations')
    const { year } = await seedYearlyFixtures()

    const expenses = await calculateYearlyExpenses(year, orgId.toString(), 30)

    expect(expenses.totalExpenses).toBe(120)
    expect(expenses.calculatedExpenses).toBe(150)
    expect(expenses.byEvent.some((e) => e.type === 'bar_mitzvah' && e.amount === 120)).toBe(
      true,
    )
  })

  it('calculateYearlyBalance combines income and expenses', async () => {
    const { calculateYearlyBalance } = await import('./calculations')
    const { year } = await seedYearlyFixtures()

    const balance = await calculateYearlyBalance(year, orgId.toString())

    expect(balance.planIncome).toBe(1300)
    expect(balance.totalExpenses).toBe(120)
    expect(balance.balance).toBe(55)
  })

  it('calculateAndSaveYear upserts a YearlyCalculation snapshot', async () => {
    const { calculateAndSaveYear } = await import('./calculations')
    const { YearlyCalculation } = await import('./models')
    const { year } = await seedYearlyFixtures()

    const saved = await calculateAndSaveYear(year, orgId.toString())
    const found = await YearlyCalculation.findOne({ organizationId: orgId, year }).lean() as import('@/lib/test/type-helpers').LeanDoc | null

    expect(saved?.balance).toBe(55)
    expect(found?.calculatedIncome).toBe(175)
    expect(found?.calculatedExpenses).toBe(120)
    expect(Array.isArray(found?.byPlan)).toBe(true)
  })

  it('countLifecycleEvents includes orphan event types from payments', async () => {
    const { countLifecycleEvents } = await import('./calculations')
    const { year } = await seedYearlyFixtures()
    const { LifecycleEventPayment } = await import('./models')

    await LifecycleEventPayment.create({
      organizationId: orgId,
      familyId,
      eventType: 'retired_type',
      eventDate: new Date('2024-05-01'),
      amount: 40,
      year,
    })

    const events = await countLifecycleEvents(year, orgId.toString())
    const orphan = events.find((e) => e.type === 'retired_type')
    expect(orphan).toMatchObject({ count: 1, amount: 40, configuredAmount: 0 })
  })

  it('updateYearlyCalculationForEvent logs and swallows errors', async () => {
    const { updateYearlyCalculationForEvent } = await import('./calculations')
    const { YearlyCalculation } = await import('./models')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const findSpy = vi.spyOn(YearlyCalculation, 'findOne').mockImplementation(() => {
      throw new Error('find failed')
    })

    await updateYearlyCalculationForEvent(2024, orgId.toString())

    expect(errSpy).toHaveBeenCalled()
    findSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('refreshing a yearly snapshot picks up newly recorded payments', async () => {
    const { calculateAndSaveYear, updateYearlyCalculationForEvent } = await import('./calculations')
    const { Payment, YearlyCalculation } = await import('./models')
    const { year } = await seedYearlyFixtures()

    await calculateAndSaveYear(year, orgId.toString())
    const before = await YearlyCalculation.findOne({ organizationId: orgId, year }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    const beforePayments = Number(before?.totalPayments ?? 0)

    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 50,
      paymentDate: new Date(`${year}-06-15`),
      year,
      type: 'membership',
      paymentMethod: 'cash',
    })

    await updateYearlyCalculationForEvent(year, orgId.toString())

    const after = await YearlyCalculation.findOne({ organizationId: orgId, year }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(after?.totalPayments).toBe(beforePayments + 50)
  })

  it('updateYearlyCalculationForEvent preserves extra donation and expense overrides', async () => {
    const { updateYearlyCalculationForEvent } = await import('./calculations')
    const { YearlyCalculation } = await import('./models')
    const { year } = await seedYearlyFixtures()

    await YearlyCalculation.create({
      organizationId: orgId,
      year,
      extraDonation: 25,
      extraExpense: 15,
      calculatedIncome: 0,
      calculatedExpenses: 0,
      balance: 0,
      byPlan: [],
      byEvent: [],
      totalPayments: 0,
      planIncome: 0,
      totalIncome: 0,
      totalExpenses: 0,
    })

    await updateYearlyCalculationForEvent(year, orgId.toString())

    const saved = await YearlyCalculation.findOne({ organizationId: orgId, year }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(saved?.extraDonation).toBe(25)
    expect(saved?.extraExpense).toBe(15)
    expect(saved?.calculatedIncome).toBe(200)
  })

  it('calculateFamilyBalance includes withdrawals and cycle charges', async () => {
    const { calculateFamilyBalance } = await import('./calculations')
    const { Withdrawal, CycleCharge } = await import('./models')
    const { asOf } = await seedFamilyWithPayments({
      planYearlyPrice: 500,
      payments: [{ amount: 600 }],
    })

    await Withdrawal.create({
      organizationId: orgId,
      familyId,
      amount: 50,
      withdrawalDate: asOf,
      reason: 'payout',
    })
    await CycleCharge.create({
      organizationId: orgId,
      familyId,
      amount: 100,
      chargeDate: asOf,
      cycleYear: 2024,
      calendar: 'gregorian',
    })

    const result = await calculateFamilyBalance(familyId.toString(), orgId.toString(), asOf)

    expect(result.totalWithdrawals).toBe(50)
    expect(result.totalCycleCharges).toBe(100)
    expect(result.balance).toBe(-50)
  })

  it('calculateFamilyBalance tolerates payment plan lookup failures', async () => {
    const { calculateFamilyBalance } = await import('./calculations')
    const { PaymentPlan } = await import('./models')
    const { asOf } = await seedFamilyWithPayments()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(PaymentPlan, 'findOne').mockRejectedValueOnce(new Error('plan lookup failed'))

    const result = await calculateFamilyBalance(familyId.toString(), orgId.toString(), asOf)

    expect(result.planCost).toBe(0)
    expect(result.totalPayments).toBeGreaterThan(0)
    errSpy.mockRestore()
  })

  it('calculateMemberBalance throws when member is missing', async () => {
    const { calculateMemberBalance } = await import('./calculations')
    const { Organization } = await import('./models')

    await Organization.create({
      _id: orgId,
      name: 'Member Missing Org',
      slug: `member-missing-${orgId.toString().slice(-6)}`,
      ownerId,
    })

    await expect(
      calculateMemberBalance(new Types.ObjectId().toString(), orgId.toString()),
    ).rejects.toThrow(/Member not found/)
  })

  it('calculateMemberBalance uses member plan cost and payments', async () => {
    const { calculateMemberBalance } = await import('./calculations')
    const { memberId, year } = await seedYearlyFixtures()
    const { Payment } = await import('./models')
    const asOf = new Date(`${year}-12-31T23:59:59.000Z`)

    await Payment.create({
      organizationId: orgId,
      familyId,
      memberId,
      amount: 300,
      paymentDate: new Date(`${year}-08-01`),
      type: 'membership',
    })

    const result = await calculateMemberBalance(memberId.toString(), orgId.toString(), asOf)

    expect(result.planCost).toBe(800)
    expect(result.totalPayments).toBe(300)
    expect(result.balance).toBe(-500)
  })

  it('calculateMemberBalance tolerates payment plan lookup failures', async () => {
    const { calculateMemberBalance } = await import('./calculations')
    const { PaymentPlan } = await import('./models')
    const { memberId, year } = await seedYearlyFixtures()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(PaymentPlan, 'findOne').mockRejectedValueOnce(new Error('plan lookup failed'))

    const result = await calculateMemberBalance(
      memberId.toString(),
      orgId.toString(),
      new Date(`${year}-12-31`),
    )

    expect(result.planCost).toBe(0)
    errSpy.mockRestore()
  })

})
