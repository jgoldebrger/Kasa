import { describe, expect, it } from 'vitest'
import { parseFamilySaveError, validateFamilyFormFields } from './family-form'

const VALID_OID = '507f1f77bcf86cd799439011'

describe('validateFamilyFormFields', () => {
  const valid = {
    name: 'Cohen',
    hebrewName: 'כהן',
    weddingDate: '2020-06-01',
    husbandHebrewName: 'דוד',
    wifeHebrewName: 'שרה',
    paymentPlanId: VALID_OID,
  }

  it('accepts a complete form', () => {
    expect(validateFamilyFormFields(valid)).toBeNull()
  })

  it('requires family name', () => {
    expect(validateFamilyFormFields({ ...valid, name: '  ' })).toMatch(/family name/i)
  })

  it('requires payment plan id', () => {
    expect(validateFamilyFormFields({ ...valid, paymentPlanId: '' })).toMatch(/payment plan/i)
  })

  it('rejects malformed payment plan id', () => {
    expect(validateFamilyFormFields({ ...valid, paymentPlanId: 'not-an-id' })).toMatch(
      /valid payment plan/i,
    )
  })
})

describe('parseFamilySaveError', () => {
  it('returns server error string', () => {
    expect(parseFamilySaveError({ error: 'Forbidden' })).toBe('Forbidden')
  })

  it('expands validation issues', () => {
    expect(
      parseFamilySaveError({
        error: 'Validation failed',
        issues: [{ path: 'weddingDate', message: 'Invalid date' }],
      }),
    ).toBe('weddingDate: Invalid date')
  })
})
