import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { setupMongo, teardownMongo } from '../test/mongo-memory'
import type { StatementPeriodAggregates } from './period'

let buildTransactionList: typeof import('./period').buildTransactionList
let statementSnapshotFromPeriod: typeof import('./period').statementSnapshotFromPeriod
let loadStatementPeriod: typeof import('./period').loadStatementPeriod

function emptyPeriod(overrides: Partial<StatementPeriodAggregates> = {}): StatementPeriodAggregates {
  return {
    payments: [],
    priorPeriodRefunds: [],
    withdrawals: [],
    lifecycleEvents: [],
    cycleCharges: [],
    totalIncome: 0,
    totalWithdrawals: 0,
    totalExpenses: 0,
    totalCycleCharges: 0,
    closingBalance: 0,
    ...overrides,
  }
}

beforeAll(async () => {
  await setupMongo()
  ;({ buildTransactionList, statementSnapshotFromPeriod, loadStatementPeriod } =
    await import('./period'))
})

afterAll(async () => {
  await teardownMongo()
})

describe('buildTransactionList', () => {
  it('sorts mixed ledger rows by date ascending', () => {
    const period = emptyPeriod({
      payments: [
        {
          paymentDate: new Date('2024-06-15'),
          amount: 100,
          refundedAmount: 0,
          type: 'membership',
          notes: '',
        },
      ],
      withdrawals: [
        {
          withdrawalDate: new Date('2024-06-01'),
          amount: 25,
          reason: 'adjustment',
        },
      ],
      cycleCharges: [
        {
          chargeDate: new Date('2024-06-20'),
          amount: 500,
          planName: 'Standard',
          cycleYear: 2024,
          notes: '',
        },
      ],
    })

    const txs = buildTransactionList(period)
    expect(txs.map((t) => t.type)).toEqual(['withdrawal', 'payment', 'cycle-charge'])
    expect(txs[0].amount).toBe(-25)
    expect(txs[1].amount).toBe(100)
    expect(txs[2].amount).toBe(-500)
  })

  it('annotates refunded in-window payments and emits prior-period refunds', () => {
    const period = emptyPeriod({
      payments: [
        {
          paymentDate: new Date('2024-06-10'),
          amount: 80,
          refundedAmount: 30,
          type: 'membership',
          notes: 'pi_secret123',
        },
      ],
      priorPeriodRefunds: [
        {
          refundedAt: new Date('2024-06-12'),
          refundedAmount: 20,
          type: 'membership',
          notes: '',
        },
      ],
    })

    const txs = buildTransactionList(period)
    const payment = txs.find((t) => t.description.includes('refunded'))
    expect(payment?.amount).toBe(50)
    expect(payment?.notes).not.toMatch(/pi_/)

    const refund = txs.find((t) => t.description.startsWith('Refund'))
    expect(refund?.amount).toBe(-20)
  })

  it('places invalid dates at the end when sorting', () => {
    const period = emptyPeriod({
      payments: [
        { paymentDate: new Date('2024-01-02'), amount: 1, refundedAmount: 0, type: 'membership' },
        { paymentDate: new Date('invalid'), amount: 2, refundedAmount: 0, type: 'membership' },
      ],
    })
    const txs = buildTransactionList(period)
    expect(txs[0].amount).toBe(1)
    expect(txs[1].amount).toBe(2)
  })

  it('formats lifecycle events, bare withdrawals, and cycle charges without plan names', () => {
    const period = emptyPeriod({
      withdrawals: [{ withdrawalDate: new Date('2024-06-05'), amount: 40, reason: '' }],
      lifecycleEvents: [
        {
          eventDate: new Date('2024-06-08'),
          eventType: 'bar_mitzvah',
          amount: 75,
          notes: 'Mazel tov',
        },
      ],
      cycleCharges: [
        {
          chargeDate: new Date('2024-06-09'),
          amount: 500,
          cycleYear: 2024,
          notes: 'annual',
        },
      ],
    })

    const txs = buildTransactionList(period)
    expect(txs.find((t) => t.type === 'withdrawal')?.description).toBe('Withdrawal')
    expect(txs.find((t) => t.type === 'event')?.description).toContain('bar_mitzvah')
    expect(txs.find((t) => t.type === 'event')?.description).toContain('Mazel tov')
    expect(txs.find((t) => t.type === 'cycle-charge')?.description).toBe(
      'Annual dues — cycle 2024',
    )
  })

  it('sorts when both transaction dates are invalid', () => {
    const period = emptyPeriod({
      payments: [
        { paymentDate: new Date('invalid'), amount: 1, refundedAmount: 0, type: 'membership' },
        { paymentDate: new Date('also-invalid'), amount: 2, refundedAmount: 0, type: 'membership' },
      ],
    })
    const txs = buildTransactionList(period)
    expect(txs).toHaveLength(2)
  })
})

describe('statementSnapshotFromPeriod', () => {
  it('maps aggregates into persisted Statement fields', () => {
    const period = emptyPeriod({
      totalIncome: 100,
      totalWithdrawals: 25,
      totalExpenses: 10,
      totalCycleCharges: 500,
      closingBalance: 65,
    })
    expect(statementSnapshotFromPeriod(50, period)).toEqual({
      openingBalance: 50,
      income: 100,
      withdrawals: 25,
      expenses: 10,
      cycleCharges: 500,
      closingBalance: 65,
    })
  })
})

describe('loadStatementPeriod (integration)', () => {
  afterEach(async () => {
    const {
      Organization,
      Family,
      Payment,
      PaymentPlan,
      Withdrawal,
      LifecycleEventPayment,
      CycleCharge,
    } = await import('../models')
    await Promise.all([
      Payment.deleteMany({}),
      Withdrawal.deleteMany({}),
      LifecycleEventPayment.deleteMany({}),
      CycleCharge.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  it('loads ledger rows and computes period totals', async () => {
    const { Organization, Family, Payment, PaymentPlan } = await import('../models')

    const ownerId = new mongoose.Types.ObjectId()
    const org = await Organization.create({
      name: 'Statement Org',
      slug: `stmt-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
    })
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Plan A',
      planNumber: 1,
      yearlyPrice: 400,
    })
    const family = await Family.create({
      organizationId: org._id,
      name: 'Test Family',
      weddingDate: new Date('2015-05-01'),
      paymentPlanId: plan._id,
    })

    const fromDate = new Date('2024-01-01T00:00:00.000Z')
    const toDate = new Date('2024-12-31T23:59:59.999Z')

    await Payment.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 150,
      paymentDate: new Date('2024-06-15'),
      type: 'membership',
      year: 2024,
    })

    const period = await loadStatementPeriod({
      organizationId: String(org._id),
      familyId: String(family._id),
      fromDate,
      toDate,
      openingBalance: 0,
    })

    expect(period.payments).toHaveLength(1)
    expect(period.payments[0].netAmount).toBe(150)
    expect(period.totalIncome).toBe(150)
    expect(typeof period.closingBalance).toBe('number')
  })

  it('subtracts prior-period refunds and sums withdrawals and cycle charges', async () => {
    const {
      Organization,
      Family,
      Payment,
      PaymentPlan,
      Withdrawal,
      CycleCharge,
      LifecycleEventPayment,
    } = await import('../models')

    const ownerId = new mongoose.Types.ObjectId()
    const org = await Organization.create({
      name: 'Ledger Org',
      slug: `ledger-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
    })
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Plan A',
      planNumber: 1,
      yearlyPrice: 400,
    })
    const family = await Family.create({
      organizationId: org._id,
      name: 'Ledger Family',
      weddingDate: new Date('2015-05-01'),
      paymentPlanId: plan._id,
    })

    const fromDate = new Date('2024-01-01T00:00:00.000Z')
    const toDate = new Date('2024-12-31T23:59:59.999Z')

    await Payment.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 200,
      paymentDate: new Date('2023-12-01'),
      refundedAmount: 50,
      refundedAt: new Date('2024-03-01'),
      type: 'membership',
      year: 2023,
    })
    await Payment.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 100,
      paymentDate: new Date('2024-06-01'),
      type: 'membership',
      year: 2024,
    })
    await Withdrawal.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 25,
      withdrawalDate: new Date('2024-07-01'),
      reason: 'adjustment',
    })
    await CycleCharge.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 400,
      chargeDate: new Date('2024-08-01'),
      cycleYear: 2024,
      calendar: 'gregorian',
      planName: 'Plan A',
    })
    await LifecycleEventPayment.create({
      organizationId: org._id,
      familyId: family._id,
      eventType: 'bar_mitzvah',
      eventDate: new Date('2024-09-01'),
      amount: 60,
      year: 2024,
    })

    const period = await loadStatementPeriod({
      organizationId: String(org._id),
      familyId: String(family._id),
      fromDate,
      toDate,
      openingBalance: 0,
    })

    expect(period.priorPeriodRefunds).toHaveLength(1)
    expect(period.totalIncome).toBe(50)
    expect(period.totalWithdrawals).toBe(25)
    expect(period.totalCycleCharges).toBe(400)
    expect(period.totalExpenses).toBe(60)
    expect(period.withdrawals).toHaveLength(1)
    expect(period.cycleCharges).toHaveLength(1)
    expect(period.lifecycleEvents).toHaveLength(1)
  })
})
