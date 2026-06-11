import { describe, expect, it } from 'vitest'
import {
  statementDateRangeBody,
  statementGenerateBody,
  statementSendSingleEmailBody,
} from './statement'

describe('statement schemas', () => {
  it('accepts a valid date range', () => {
    const result = statementDateRangeBody.safeParse({
      fromDate: '2025-01-01',
      toDate: '2025-06-30',
    })
    expect(result.success).toBe(true)
  })

  it('rejects ranges longer than one year', () => {
    const result = statementDateRangeBody.safeParse({
      fromDate: '2020-01-01',
      toDate: '2022-01-02',
    })
    expect(result.success).toBe(false)
  })

  it('requires familyId on generate body', () => {
    const result = statementGenerateBody.safeParse({
      fromDate: '2025-01-01',
      toDate: '2025-06-30',
    })
    expect(result.success).toBe(false)
  })

  it('requires a statement id for single-email send', () => {
    const result = statementSendSingleEmailBody.safeParse({})
    expect(result.success).toBe(false)
  })
})
