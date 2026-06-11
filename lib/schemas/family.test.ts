import { describe, expect, it } from 'vitest'
import { familyCreateBody, familyMemberCreateBody } from './family'

const VALID_OID = '507f1f77bcf86cd799439011'

describe('family schemas', () => {
  describe('familyCreateBody', () => {
    it('accepts a valid family create payload', () => {
      const result = familyCreateBody.safeParse({
        name: 'Cohen Family',
        weddingDate: '2015-08-20',
        paymentPlanId: VALID_OID,
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional fields', () => {
      const result = familyCreateBody.safeParse({
        name: 'Cohen Family',
        weddingDate: '2015-08-20',
        paymentPlanId: VALID_OID,
        hebrewName: 'משפחת כהן',
        husbandFirstName: 'David',
        email: 'family@example.com',
        emailOptOut: true,
      })
      expect(result.success).toBe(true)
    })

    it('requires paymentPlanId at create time', () => {
      const result = familyCreateBody.safeParse({
        name: 'Cohen Family',
        weddingDate: '2015-08-20',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing name', () => {
      const result = familyCreateBody.safeParse({
        weddingDate: '2015-08-20',
        paymentPlanId: VALID_OID,
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid weddingDate', () => {
      const result = familyCreateBody.safeParse({
        name: 'Cohen Family',
        weddingDate: 'invalid',
        paymentPlanId: VALID_OID,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('familyMemberCreateBody', () => {
    it('accepts a valid member create payload', () => {
      const result = familyMemberCreateBody.safeParse({
        firstName: 'Moshe',
        lastName: 'Cohen',
        birthDate: '2010-03-15',
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional member fields', () => {
      const result = familyMemberCreateBody.safeParse({
        firstName: 'Moshe',
        lastName: 'Cohen',
        birthDate: '2010-03-15',
        hebrewFirstName: 'משה',
        gender: 'male',
        paymentPlanId: VALID_OID,
      })
      expect(result.success).toBe(true)
    })

    it('requires birthDate at create time', () => {
      const result = familyMemberCreateBody.safeParse({
        firstName: 'Moshe',
        lastName: 'Cohen',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing firstName', () => {
      const result = familyMemberCreateBody.safeParse({
        lastName: 'Cohen',
        birthDate: '2010-03-15',
      })
      expect(result.success).toBe(false)
    })

    it('does not include familyId (provided by route)', () => {
      const result = familyMemberCreateBody.safeParse({
        familyId: VALID_OID,
        firstName: 'Moshe',
        lastName: 'Cohen',
        birthDate: '2010-03-15',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect('familyId' in result.data).toBe(false)
      }
    })
  })
})
