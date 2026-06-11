import { describe, expect, it } from 'vitest'
import { calculationPostBody, calculationQuery } from './calculation'

describe('calculation schemas', () => {
  describe('calculationQuery', () => {
    it('accepts an empty query', () => {
      const result = calculationQuery.safeParse({})
      expect(result.success).toBe(true)
    })

    it('accepts optional year', () => {
      const result = calculationQuery.safeParse({ year: '2025' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.year).toBe(2025)
      }
    })

    it('rejects year below 1900', () => {
      const result = calculationQuery.safeParse({ year: 1800 })
      expect(result.success).toBe(false)
    })

    it('rejects year above 2200', () => {
      const result = calculationQuery.safeParse({ year: 2300 })
      expect(result.success).toBe(false)
    })
  })

  describe('calculationPostBody', () => {
    it('accepts year with default extras', () => {
      const result = calculationPostBody.safeParse({ year: 2025 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.extraDonation).toBe(0)
        expect(result.data.extraExpense).toBe(0)
      }
    })

    it('accepts explicit extra donation and expense', () => {
      const result = calculationPostBody.safeParse({
        year: 2025,
        extraDonation: 500,
        extraExpense: 100.5,
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing year', () => {
      const result = calculationPostBody.safeParse({})
      expect(result.success).toBe(false)
    })

    it('rejects extra amounts with more than two decimal places', () => {
      const result = calculationPostBody.safeParse({
        year: 2025,
        extraDonation: 1.999,
      })
      expect(result.success).toBe(false)
    })
  })
})
