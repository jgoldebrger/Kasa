import { describe, expect, it } from 'vitest'
import { MAX_DATE_RANGE_MS, validateDateRange } from './validate-date-range'

describe('validateDateRange', () => {
  it('accepts a valid one-year span', () => {
    const from = new Date('2024-01-01')
    const to = new Date('2024-12-31')
    expect(validateDateRange(from, to)).toBeNull()
  })

  it('rejects inverted ranges', () => {
    expect(
      validateDateRange(new Date('2024-06-01'), new Date('2024-01-01')),
    ).toMatch(/on or before/)
  })

  it('rejects spans longer than the max', () => {
    const from = new Date('2020-01-01')
    const to = new Date(from.getTime() + MAX_DATE_RANGE_MS + 86_400_000)
    expect(validateDateRange(from, to)).toMatch(/cannot exceed/)
  })

  it('rejects invalid and out-of-range years', () => {
    expect(validateDateRange(new Date('invalid'), new Date())).toBe('Invalid date')
    expect(
      validateDateRange(new Date('1800-01-01'), new Date('1800-12-31')),
    ).toMatch(/1900/)
  })
})
