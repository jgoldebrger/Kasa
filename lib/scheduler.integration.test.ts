import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import mongoose from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'
import { previousStatementPeriodBounds, tolerantMsRange } from './date-utils'
import type { StatementPeriodAggregates } from './statements/period'

const { calculateFamilyBalance, loadStatementPeriod } = vi.hoisted(() => ({
  calculateFamilyBalance: vi.fn(),
  loadStatementPeriod: vi.fn(),
}))

vi.mock('./calculations', () => ({
  calculateFamilyBalance,
}))

vi.mock('./statements/period', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./statements/period')>()
  return {
    ...actual,
    loadStatementPeriod,
  }
})

function mockPeriod(closingBalance: number): StatementPeriodAggregates {
  return {
    payments: [],
    priorPeriodRefunds: [],
    withdrawals: [],
    lifecycleEvents: [],
    cycleCharges: [],
    totalIncome: 100,
    totalWithdrawals: 0,
    totalExpenses: 0,
    totalCycleCharges: 0,
    closingBalance,
  }
}

describe('generateMonthlyStatements (integration)', () => {
  const ownerId = new mongoose.Types.ObjectId()
  const userId = new mongoose.Types.ObjectId()
  let orgId: string
  let familyId: mongoose.Types.ObjectId

  const targetYear = 2024
  const targetMonth = 6
  let fromDate: Date
  let toDate: Date

  beforeAll(async () => {
    await setupMongo()
    const period = previousStatementPeriodBounds('gregorian', 'UTC', new Date(), {
      year: targetYear,
      month: targetMonth,
    })
    fromDate = period.fromDate
    toDate = period.toDate
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    calculateFamilyBalance.mockReset()
    loadStatementPeriod.mockReset()
    const { Organization, Family, PaymentPlan, Statement, Counter } = await import('./models')
    await Promise.all([
      Statement.deleteMany({}),
      Counter.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedOrgAndFamily() {
    const { Organization, PaymentPlan, Family } = await import('./models')
    const org = await Organization.create({
      name: 'Scheduler Test Org',
      slug: `sched-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
      monthlyStatementCalendar: 'gregorian',
    })
    orgId = org._id.toString()
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    const family = await Family.create({
      organizationId: org._id,
      name: 'Test Family',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: plan._id,
    })
    familyId = family._id
    return { org, family }
  }

  it('creates a statement when none exists for the period', async () => {
    await seedOrgAndFamily()
    calculateFamilyBalance.mockResolvedValue({ balance: 10 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(110))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const result = await generateMonthlyStatements(orgId, targetYear, targetMonth)

    expect(result.success).toBe(true)
    expect(result.generated).toBe(1)
    expect(result.failed).toBe(0)

    const rows = await Statement.find({ organizationId: orgId, familyId }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].openingBalance).toBe(10)
    expect(rows[0].closingBalance).toBe(110)
    expect(rows[0].fromDate.getTime()).toBe(fromDate.getTime())
    expect(rows[0].toDate.getTime()).toBe(toDate.getTime())
  })

  it('refreshes an existing statement instead of creating a duplicate (idempotent)', async () => {
    await seedOrgAndFamily()
    const { Statement } = await import('./models')

    const existing = await Statement.create({
      organizationId: orgId,
      familyId,
      statementNumber: `STMT-${familyId.toString().slice(-6)}-1`,
      date: new Date(),
      fromDate,
      toDate,
      openingBalance: 0,
      income: 0,
      withdrawals: 0,
      expenses: 0,
      cycleCharges: 0,
      closingBalance: 50,
    })

    calculateFamilyBalance.mockResolvedValue({ balance: 25 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(175))

    const { generateMonthlyStatements } = await import('./scheduler')

    const first = await generateMonthlyStatements(orgId, targetYear, targetMonth)
    expect(first.success).toBe(true)
    expect(first.generated).toBe(0)
    expect(first.failed).toBe(0)

    let rows = await Statement.find({ organizationId: orgId, familyId }).lean()
    expect(rows).toHaveLength(1)
    expect(String(rows[0]._id)).toBe(String(existing._id))
    expect(rows[0].openingBalance).toBe(25)
    expect(rows[0].closingBalance).toBe(175)
    expect(rows[0].income).toBe(100)

    loadStatementPeriod.mockResolvedValue(mockPeriod(200))
    calculateFamilyBalance.mockResolvedValue({ balance: 30 })

    const second = await generateMonthlyStatements(orgId, targetYear, targetMonth)
    expect(second.generated).toBe(0)

    rows = await Statement.find({ organizationId: orgId, familyId }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].openingBalance).toBe(30)
    expect(rows[0].closingBalance).toBe(200)
    expect(calculateFamilyBalance).toHaveBeenCalledTimes(2)
    expect(loadStatementPeriod).toHaveBeenCalledTimes(2)
  })

  it('throws when organizationId is missing', async () => {
    const { generateMonthlyStatements } = await import('./scheduler')
    await expect(generateMonthlyStatements('')).rejects.toThrow(
      'generateMonthlyStatements: organizationId is required',
    )
  })

  it('uses the org default period when year and month are omitted', async () => {
    await seedOrgAndFamily()
    calculateFamilyBalance.mockResolvedValue({ balance: 0 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(50))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')
    const { previousStatementPeriodBounds } = await import('./date-utils')

    const result = await generateMonthlyStatements(orgId)
    const period = previousStatementPeriodBounds('gregorian', 'UTC')

    expect(result.success).toBe(true)
    expect(result.year).toBe(period.year)
    expect(result.month).toBe(period.month)

    const row = await Statement.findOne({ organizationId: orgId, familyId }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(row).toBeTruthy()
    expect((row!.fromDate as Date).getTime()).toBe(period.fromDate.getTime())
    expect((row!.toDate as Date).getTime()).toBe(period.toDate.getTime())
  })

  it('records per-family errors without aborting other families', async () => {
    const { Organization, PaymentPlan, Family } = await import('./models')
    const org = await Organization.create({
      name: 'Scheduler Error Org',
      slug: `sched-err-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
      monthlyStatementCalendar: 'gregorian',
    })
    orgId = org._id.toString()
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    const good = await Family.create({
      organizationId: org._id,
      name: 'Good Family',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: plan._id,
    })
    const bad = await Family.create({
      organizationId: org._id,
      name: 'Bad Family',
      weddingDate: new Date('2011-01-01'),
      paymentPlanId: plan._id,
    })
    familyId = good._id

    calculateFamilyBalance.mockImplementation(async (fid: string) => {
      if (fid === bad._id.toString()) {
        throw new Error('balance lookup failed')
      }
      return { balance: 5 }
    })
    loadStatementPeriod.mockResolvedValue(mockPeriod(105))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const result = await generateMonthlyStatements(orgId, targetYear, targetMonth)

    expect(result.success).toBe(true)
    expect(result.generated).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      familyId: bad._id.toString(),
      familyName: 'Bad Family',
      error: 'balance lookup failed',
    })

    const rows = await Statement.find({ organizationId: orgId }).lean() as import('@/lib/test/type-helpers').LeanDoc[]
    expect(rows).toHaveLength(1)
    expect(String((rows[0] as import('@/lib/test/type-helpers').LeanDoc).familyId)).toBe(String(good._id))
  })

  it('records an error when duplicate-key races without a persisted row', async () => {
    await seedOrgAndFamily()
    calculateFamilyBalance.mockResolvedValue({ balance: 12 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(112))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const createSpy = vi.spyOn(Statement, 'create').mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate'), { code: 11000 })
    })
    const findSpy = vi.spyOn(Statement, 'findOne').mockResolvedValueOnce(null as never)

    const result = await generateMonthlyStatements(orgId, targetYear, targetMonth)

    createSpy.mockRestore()
    findSpy.mockRestore()

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toMatch(/duplicate/)
    expect(result.generated).toBe(0)
  })

  it('continues when parallel creates race on the same period (E11000)', async () => {
    await seedOrgAndFamily()
    calculateFamilyBalance.mockResolvedValue({ balance: 12 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(112))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const [first, second] = await Promise.all([
      generateMonthlyStatements(orgId, targetYear, targetMonth),
      generateMonthlyStatements(orgId, targetYear, targetMonth),
    ])

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)

    const rows = await Statement.find({
      organizationId: orgId,
      familyId,
      fromDate: tolerantMsRange(fromDate),
      toDate: tolerantMsRange(toDate),
    }).lean()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.length).toBeLessThanOrEqual(2)
    expect(first.generated + second.generated).toBeGreaterThanOrEqual(1)
    expect(first.generated + second.generated).toBeLessThanOrEqual(2)
  })

  it('processes all families across internal batches when selfUrl is omitted', async () => {
    const { Organization, PaymentPlan, Family } = await import('./models')
    const org = await Organization.create({
      name: 'Chunked Scheduler Org',
      slug: `sched-chunk-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
      monthlyStatementCalendar: 'gregorian',
    })
    orgId = org._id.toString()
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    await Family.create(
      Array.from({ length: 7 }, (_, i) => ({
        organizationId: org._id,
        name: `Chunk Family ${i}`,
        weddingDate: new Date('2010-01-01'),
        paymentPlanId: plan._id,
      })),
    )

    calculateFamilyBalance.mockResolvedValue({ balance: 0 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(50))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const result = await generateMonthlyStatements(orgId, targetYear, targetMonth, {
      batchSize: 3,
    })

    expect(result.success).toBe(true)
    expect(result.generated).toBe(7)
    expect(result.hasMore).toBe(false)
    const rows = await Statement.find({ organizationId: orgId }).lean()
    expect(rows).toHaveLength(7)
  })

  it('processes one family batch and self-continues when selfUrl is set', async () => {
    const { Organization, PaymentPlan, Family } = await import('./models')
    const org = await Organization.create({
      name: 'Async Scheduler Org',
      slug: `sched-async-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
      monthlyStatementCalendar: 'gregorian',
    })
    orgId = org._id.toString()
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    const families = await Family.create(
      Array.from({ length: 7 }, (_, i) => ({
        organizationId: org._id,
        name: `Async Family ${i}`,
        weddingDate: new Date('2010-01-01'),
        paymentPlanId: plan._id,
      })),
    )

    calculateFamilyBalance.mockResolvedValue({ balance: 0 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(50))

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.CRON_SECRET = 'test-secret'

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const result = await generateMonthlyStatements(orgId, targetYear, targetMonth, {
      batchSize: 5,
      selfUrl: 'https://example.com/api/jobs/generate-monthly-statements/worker',
    })

    expect(result.success).toBe(true)
    expect(result.generated).toBe(5)
    expect(result.hasMore).toBe(true)
    expect(result.familyCursorOut).toBe(families[4]._id.toString())

    const rows = await Statement.find({ organizationId: orgId }).lean()
    expect(rows).toHaveLength(5)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('familyCursor=')
    expect(url).toContain(`organizationId=${orgId}`)
    expect(url).toContain(`year=${targetYear}`)
    expect(url).toContain(`month=${targetMonth}`)

    vi.unstubAllGlobals()
    delete process.env.CRON_SECRET
  })

  it('stays idempotent across chunked batches (unique period index)', async () => {
    await seedOrgAndFamily()
    calculateFamilyBalance.mockResolvedValue({ balance: 10 })
    loadStatementPeriod.mockResolvedValue(mockPeriod(110))

    const { generateMonthlyStatements } = await import('./scheduler')
    const { Statement } = await import('./models')

    const first = await generateMonthlyStatements(orgId, targetYear, targetMonth, { batchSize: 1 })
    expect(first.generated).toBe(1)

    const second = await generateMonthlyStatements(orgId, targetYear, targetMonth, { batchSize: 5 })
    expect(second.generated).toBe(0)

    const rows = await Statement.find({
      organizationId: orgId,
      familyId,
      fromDate: tolerantMsRange(fromDate),
      toDate: tolerantMsRange(toDate),
    }).lean()
    expect(rows).toHaveLength(1)
  })

  it('rethrows when connectDB fails at startup', async () => {
    vi.resetModules()
    vi.doMock('./database', () => ({
      default: vi.fn().mockRejectedValue(new Error('db unavailable')),
    }))

    const { generateMonthlyStatements } = await import('./scheduler')
    await expect(generateMonthlyStatements(orgId)).rejects.toThrow('db unavailable')

    vi.doUnmock('./database')
    vi.resetModules()
  })
})
