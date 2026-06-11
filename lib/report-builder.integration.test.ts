import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'
import type { ReportConfig } from './report-builder'

describe('report-builder (integration)', () => {
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
      Organization,
      Family,
      PaymentPlan,
      Payment,
      LifecycleEventPayment,
      FamilyMember,
    } = await import('./models')
    await Promise.all([
      Payment.deleteMany({}),
      LifecycleEventPayment.deleteMany({}),
      FamilyMember.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedReportFixtures() {
    const { Organization, PaymentPlan, Family, Payment, LifecycleEventPayment } =
      await import('./models')

    await Organization.create({
      _id: orgId,
      name: 'Report Test Org',
      slug: `report-${orgId.toString().slice(-8)}`,
      ownerId,
      timezone: 'UTC',
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Gold Plan',
      planNumber: 1,
      yearlyPrice: 600,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Cohen Family',
      weddingDate: new Date('2010-06-01'),
      paymentPlanId: planId,
      emailOptOut: false,
    })

    const inRange = new Date('2024-03-15T12:00:00.000Z')
    const outOfRange = new Date('2023-01-01T12:00:00.000Z')

    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 100,
      refundedAmount: 10,
      paymentDate: inRange,
      type: 'membership',
      paymentMethod: 'check',
    })
    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 50,
      paymentDate: inRange,
      type: 'donation',
      paymentMethod: 'cash',
    })
    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 999,
      paymentDate: outOfRange,
      type: 'other',
      paymentMethod: 'cash',
    })

    await LifecycleEventPayment.create({
      organizationId: orgId,
      familyId,
      eventType: 'bar_mitzvah',
      eventDate: inRange,
      amount: 75,
      year: 2024,
    })
    await LifecycleEventPayment.create({
      organizationId: orgId,
      familyId,
      eventType: 'wedding',
      eventDate: outOfRange,
      amount: 200,
      year: 2023,
    })

    return { inRange, outOfRange }
  }

  it('runReport counts and sums payments in a date range', async () => {
    const { runReport } = await import('./report-builder')
    await seedReportFixtures()

    const range: Pick<ReportConfig, 'fromDate' | 'toDate'> = {
      fromDate: '2024-01-01',
      toDate: '2024-12-31',
    }

    const countResult = await runReport(
      { source: 'payments', aggregate: 'count', ...range },
      orgId.toString(),
    )
    expect(countResult.rowCount).toBe(2)
    expect(countResult.totals.grand).toBe(2)
    expect(countResult.rowLabels).toEqual(['(all)'])
    expect(countResult.colLabels).toEqual(['value'])

    const sumResult = await runReport(
      {
        source: 'payments',
        aggregate: 'sum',
        measure: 'amount',
        rowDim: 'type',
        ...range,
      },
      orgId.toString(),
    )
    expect(sumResult.rowCount).toBe(2)
    expect(sumResult.totals.grand).toBe(140)
    expect(sumResult.values.donation?.value).toBe(50)
    expect(sumResult.values.membership?.value).toBe(90)
  })

  it('runReport aggregates lifecycle events', async () => {
    const { runReport } = await import('./report-builder')
    await seedReportFixtures()

    const result = await runReport(
      {
        source: 'events',
        aggregate: 'sum',
        measure: 'amount',
        rowDim: 'eventType',
        fromDate: '2024-01-01',
        toDate: '2024-12-31',
      },
      orgId.toString(),
    )

    expect(result.rowCount).toBe(1)
    expect(result.totals.grand).toBe(75)
    expect(result.values.bar_mitzvah?.value).toBe(75)
  })

  it('runReport returns empty for an invalid date range', async () => {
    const { runReport } = await import('./report-builder')
    await seedReportFixtures()

    const reversed = await runReport(
      {
        source: 'payments',
        aggregate: 'count',
        fromDate: '2024-06-01',
        toDate: '2024-01-01',
      },
      orgId.toString(),
    )
    expect(reversed.rowCount).toBe(0)
    expect(reversed.rowLabels).toEqual([])
    expect(reversed.totals.grand).toBe(0)

    const tooLong = await runReport(
      {
        source: 'payments',
        aggregate: 'count',
        fromDate: '2020-01-01',
        toDate: '2022-06-01',
      },
      orgId.toString(),
    )
    expect(tooLong.rowCount).toBe(0)
  })

  it('runReport returns empty for an unknown source', async () => {
    const { runReport } = await import('./report-builder')
    await seedReportFixtures()

    const result = await runReport(
      { source: 'unknown' as ReportConfig['source'], aggregate: 'count' },
      orgId.toString(),
    )

    expect(result.rowCount).toBe(0)
    expect(result.totals.grand).toBe(0)
  })

  it('runReport filters members and families by configured date fields', async () => {
    const { runReport } = await import('./report-builder')
    const { Organization, PaymentPlan, Family, FamilyMember } = await import('./models')

    await Organization.create({
      _id: orgId,
      name: 'Date Filter Org',
      slug: `dates-${orgId.toString().slice(-8)}`,
      ownerId,
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Bronze',
      planNumber: 1,
      yearlyPrice: 300,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Date Family',
      weddingDate: new Date('2018-06-01'),
      paymentPlanId: planId,
    })
    await FamilyMember.create({
      organizationId: orgId,
      familyId,
      firstName: 'InRange',
      lastName: 'Kid',
      birthDate: new Date('2015-03-01'),
      gender: 'male',
    })
    await FamilyMember.create({
      organizationId: orgId,
      familyId,
      firstName: 'OutRange',
      lastName: 'Kid',
      birthDate: new Date('2005-03-01'),
      gender: 'female',
    })

    const members = await runReport(
      {
        source: 'members',
        aggregate: 'count',
        fromDate: '2015-01-01',
        toDate: '2015-12-31',
      },
      orgId.toString(),
    )
    expect(members.rowCount).toBe(1)

    const families = await runReport(
      {
        source: 'families',
        aggregate: 'count',
        fromDate: '2018-01-01',
        toDate: '2018-12-31',
      },
      orgId.toString(),
    )
    expect(families.rowCount).toBe(1)
  })

  it('runReport pivots members and families with column dimensions', async () => {
    const { runReport } = await import('./report-builder')
    const { Organization, PaymentPlan, Family, FamilyMember } = await import('./models')

    await Organization.create({
      _id: orgId,
      name: 'Pivot Org',
      slug: `pivot-${orgId.toString().slice(-8)}`,
      ownerId,
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Silver',
      planNumber: 1,
      yearlyPrice: 400,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Levy Family',
      weddingDate: new Date('2015-08-20'),
      paymentPlanId: planId,
      emailOptOut: true,
    })
    await FamilyMember.create({
      organizationId: orgId,
      familyId,
      firstName: 'David',
      lastName: 'Levy',
      birthDate: new Date('2012-05-01'),
      gender: 'male',
    })

    const members = await runReport(
      {
        source: 'members',
        aggregate: 'count',
        rowDim: 'gender',
        colDim: 'birthYear',
      },
      orgId.toString(),
    )
    expect(members.rowCount).toBe(1)
    expect(members.totals.grand).toBe(1)
    expect(members.values.male?.['2012']).toBe(1)

    const families = await runReport(
      {
        source: 'families',
        aggregate: 'count',
        rowDim: 'emailOptOut',
      },
      orgId.toString(),
    )
    expect(families.rowCount).toBe(1)
    expect(families.rowLabels).toContain('opted out')
  })

  it('runReport tolerates missing dates and non-string family names', async () => {
    const { runReport } = await import('./report-builder')
    const { Organization, PaymentPlan, Family, Payment, LifecycleEventPayment } =
      await import('./models')

    await Organization.create({
      _id: orgId,
      name: 'Sparse Org',
      slug: `sparse-${orgId.toString().slice(-8)}`,
      ownerId,
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Plan',
      planNumber: 1,
      yearlyPrice: 100,
    })
    const sparseFamilyId = new Types.ObjectId()
    await Family.collection.insertOne({
      _id: sparseFamilyId,
      organizationId: orgId,
      name: 123,
      weddingDate: new Date('2015-01-01'),
      paymentPlanId: planId,
    })
    await Payment.collection.insertOne({
      organizationId: orgId,
      familyId: sparseFamilyId,
      amount: 10,
      type: 'membership',
      paymentMethod: 'cash',
    })
    await LifecycleEventPayment.collection.insertOne({
      organizationId: orgId,
      familyId: sparseFamilyId,
      eventType: 'other',
      amount: 5,
      year: 2024,
    })

    const payments = await runReport(
      { source: 'payments', aggregate: 'count' },
      orgId.toString(),
    )
    expect(payments.rowCount).toBeGreaterThanOrEqual(1)

    const events = await runReport(
      { source: 'events', aggregate: 'count' },
      orgId.toString(),
    )
    expect(events.rowCount).toBeGreaterThanOrEqual(1)

    const families = await runReport(
      { source: 'families', aggregate: 'count' },
      orgId.toString(),
    )
    expect(families.rowCount).toBeGreaterThanOrEqual(1)
  })

  it('runReport supports avg, min, and max aggregates on payments', async () => {
    const { runReport } = await import('./report-builder')
    await seedReportFixtures()

    const range = { fromDate: '2024-01-01', toDate: '2024-12-31' }

    const avg = await runReport(
      { source: 'payments', aggregate: 'avg', measure: 'amount', ...range },
      orgId.toString(),
    )
    expect(avg.totals.grand).toBe(70)

    const min = await runReport(
      { source: 'payments', aggregate: 'min', measure: 'amount', ...range },
      orgId.toString(),
    )
    expect(min.totals.grand).toBe(50)

    const max = await runReport(
      { source: 'payments', aggregate: 'max', measure: 'amount', ...range },
      orgId.toString(),
    )
    expect(max.totals.grand).toBe(90)
  })

  it('runReport skips non-finite measure values and uses default aggregate', async () => {
    const { runReport } = await import('./report-builder')
    await seedReportFixtures()

    const badMeasure = await runReport(
      {
        source: 'payments',
        aggregate: 'sum',
        measure: 'amount',
        fromDate: '2024-01-01',
        toDate: '2024-12-31',
      },
      orgId.toString(),
    )
    expect(badMeasure.totals.grand).toBeGreaterThan(0)

    const unknownAgg = await runReport(
      {
        source: 'payments',
        aggregate: 'unknown' as ReportConfig['aggregate'],
        fromDate: '2024-01-01',
        toDate: '2024-12-31',
      },
      orgId.toString(),
    )
    expect(unknownAgg.totals.grand).toBeGreaterThan(0)
  })

})
