import { describe, expect, it } from 'vitest'
import {
  reportRunBody,
  savedReportConfig,
  savedReportCreateBody,
  savedReportUpdateBody,
  statementDateRangeBody,
} from './report'

const validConfig = {
  source: 'payments' as const,
  aggregate: 'sum' as const,
}

describe('report schemas', () => {
  describe('savedReportConfig', () => {
    it('accepts minimal config with source and aggregate', () => {
      const result = savedReportConfig.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('accepts optional dimensions and date filters', () => {
      const result = savedReportConfig.safeParse({
        ...validConfig,
        rowDim: 'familyId',
        colDim: 'month',
        measure: 'amount',
        fromDate: '2025-01-01',
        toDate: '2025-12-31',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid source', () => {
      const result = savedReportConfig.safeParse({
        ...validConfig,
        source: 'invoices',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid aggregate', () => {
      const result = savedReportConfig.safeParse({
        ...validConfig,
        aggregate: 'median',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('savedReportCreateBody', () => {
    it('accepts a valid saved report create payload', () => {
      const result = savedReportCreateBody.safeParse({
        name: 'Annual payments',
        source: 'payments',
        config: validConfig,
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional description', () => {
      const result = savedReportCreateBody.safeParse({
        name: 'Annual payments',
        description: 'Totals by family',
        source: 'families',
        config: { source: 'families', aggregate: 'count' },
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing name', () => {
      const result = savedReportCreateBody.safeParse({
        source: 'payments',
        config: validConfig,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('savedReportUpdateBody', () => {
    it('accepts a partial update', () => {
      const result = savedReportUpdateBody.safeParse({
        name: 'Renamed report',
      })
      expect(result.success).toBe(true)
    })

    it('accepts config-only update', () => {
      const result = savedReportUpdateBody.safeParse({
        config: { source: 'events', aggregate: 'count' },
      })
      expect(result.success).toBe(true)
    })

    it('accepts an empty partial update', () => {
      const result = savedReportUpdateBody.safeParse({})
      expect(result.success).toBe(true)
    })
  })

  describe('reportRunBody', () => {
    it('accepts the same shape as savedReportConfig', () => {
      const result = reportRunBody.safeParse({
        source: 'members',
        aggregate: 'count',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid source', () => {
      const result = reportRunBody.safeParse({
        source: 'unknown',
        aggregate: 'sum',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('statementDateRangeBody', () => {
    it('accepts a valid date range', () => {
      const result = statementDateRangeBody.safeParse({
        fromDate: '2025-01-01',
        toDate: '2025-06-30',
      })
      expect(result.success).toBe(true)
    })

    it('rejects fromDate after toDate', () => {
      const result = statementDateRangeBody.safeParse({
        fromDate: '2025-12-01',
        toDate: '2025-01-01',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing dates', () => {
      const result = statementDateRangeBody.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
