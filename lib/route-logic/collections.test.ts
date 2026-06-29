import { describe, it, expect } from 'vitest'
import {
  daysBetween,
  isDelinquentBalance,
  resolveDaysOverdue,
  computeAgingBuckets,
  filterByAgingBucket,
  type DelinquentFamilyRow,
} from './collections'

describe('collections delinquency helpers', () => {
  const ref = new Date('2026-06-15T12:00:00.000Z')

  it('isDelinquentBalance is true only for negative balances', () => {
    expect(isDelinquentBalance(-1)).toBe(true)
    expect(isDelinquentBalance(0)).toBe(false)
    expect(isDelinquentBalance(100)).toBe(false)
  })

  it('daysBetween counts whole days', () => {
    const start = new Date('2026-06-01T00:00:00.000Z')
    const end = new Date('2026-06-15T00:00:00.000Z')
    expect(daysBetween(start, end)).toBe(14)
  })

  it('resolveDaysOverdue prefers last payment over wedding date', () => {
    const days = resolveDaysOverdue(
      {
        lastPaymentDate: '2026-05-01',
        weddingDate: '2020-01-01',
      },
      ref,
    )
    expect(days).toBe(45)
  })

  it('resolveDaysOverdue falls back to wedding date when no payments', () => {
    const days = resolveDaysOverdue({ weddingDate: '2026-01-01' }, ref)
    expect(days).toBeGreaterThan(160)
  })

  it('resolveDaysOverdue returns null without anchors', () => {
    expect(resolveDaysOverdue({}, ref)).toBeNull()
  })

  it('computeAgingBuckets counts 30/60/90 day buckets', () => {
    const rows = [
      { daysOverdue: 35 },
      { daysOverdue: 65 },
      { daysOverdue: 95 },
      { daysOverdue: 10 },
      { daysOverdue: null },
    ]
    expect(computeAgingBuckets(rows)).toEqual({ days30: 1, days60: 1, days90: 1 })
  })

  it('computeAgingBuckets returns null when no row qualifies', () => {
    expect(computeAgingBuckets([{ daysOverdue: 5 }, { daysOverdue: null }])).toBeNull()
  })

  it('filterByAgingBucket filters delinquent rows', () => {
    const rows: DelinquentFamilyRow[] = [
      {
        familyId: 'a',
        familyName: 'A',
        balance: -100,
        amountOwed: 100,
        lastPaymentDate: null,
        daysOverdue: 35,
      },
      {
        familyId: 'b',
        familyName: 'B',
        balance: -200,
        amountOwed: 200,
        lastPaymentDate: null,
        daysOverdue: 70,
      },
      {
        familyId: 'c',
        familyName: 'C',
        balance: -300,
        amountOwed: 300,
        lastPaymentDate: null,
        daysOverdue: 100,
      },
    ]
    expect(filterByAgingBucket(rows, 30).map((r) => r.familyId)).toEqual(['a'])
    expect(filterByAgingBucket(rows, 60).map((r) => r.familyId)).toEqual(['b'])
    expect(filterByAgingBucket(rows, 90).map((r) => r.familyId)).toEqual(['c'])
    expect(filterByAgingBucket(rows, 'all')).toHaveLength(3)
  })
})
