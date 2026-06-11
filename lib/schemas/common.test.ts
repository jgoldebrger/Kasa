import { describe, expect, it } from 'vitest'
import {
  email,
  isoDate,
  moneyAmount,
  objectId,
  optionalString,
  paginationCursor,
  paginationLimit,
  password,
} from './common'

const VALID_OID = '507f1f77bcf86cd799439011'
const STRONG_PASSWORD = 'StrongPassword1!'

describe('common schemas', () => {
  describe('objectId', () => {
    it('accepts a valid 24-char hex id', () => {
      const result = objectId.safeParse(VALID_OID)
      expect(result.success).toBe(true)
    })

    it('rejects ids with wrong length', () => {
      const result = objectId.safeParse('507f1f77bcf86cd79943901')
      expect(result.success).toBe(false)
    })

    it('rejects non-hex characters', () => {
      const result = objectId.safeParse('507f1f77bcf86cd79943901g')
      expect(result.success).toBe(false)
    })
  })

  describe('email', () => {
    it('accepts a valid email and normalizes case', () => {
      const result = email.safeParse('  User@Example.COM  ')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('user@example.com')
      }
    })

    it('rejects malformed addresses', () => {
      const result = email.safeParse('not-an-email')
      expect(result.success).toBe(false)
    })

    it('rejects addresses over 254 characters', () => {
      const local = 'a'.repeat(250)
      const result = email.safeParse(`${local}@example.com`)
      expect(result.success).toBe(false)
    })
  })

  describe('password', () => {
    it('accepts a strong password meeting composition rules', () => {
      const result = password.safeParse(STRONG_PASSWORD)
      expect(result.success).toBe(true)
    })

    it('rejects passwords shorter than 10 characters', () => {
      const result = password.safeParse('Short1!')
      expect(result.success).toBe(false)
    })

    it('rejects passwords with fewer than three character classes', () => {
      const result = password.safeParse('alllowercase')
      expect(result.success).toBe(false)
    })

    it('rejects common weak passwords', () => {
      const result = password.safeParse('password123')
      expect(result.success).toBe(false)
    })
  })

  describe('moneyAmount', () => {
    it('accepts amounts with at most two decimal places', () => {
      const result = moneyAmount.safeParse(99.99)
      expect(result.success).toBe(true)
    })

    it('accepts zero', () => {
      const result = moneyAmount.safeParse(0)
      expect(result.success).toBe(true)
    })

    it('rejects more than two decimal places', () => {
      const result = moneyAmount.safeParse(10.999)
      expect(result.success).toBe(false)
    })

    it('rejects negative amounts', () => {
      const result = moneyAmount.safeParse(-1)
      expect(result.success).toBe(false)
    })

    it('rejects amounts above the cap', () => {
      const result = moneyAmount.safeParse(10_000_001)
      expect(result.success).toBe(false)
    })
  })

  describe('paginationLimit', () => {
    it('accepts a positive limit within range', () => {
      const result = paginationLimit.safeParse(50)
      expect(result.success).toBe(true)
    })

    it('allows undefined', () => {
      const result = paginationLimit.safeParse(undefined)
      expect(result.success).toBe(true)
    })

    it('rejects limits above 500', () => {
      const result = paginationLimit.safeParse(501)
      expect(result.success).toBe(false)
    })

    it('rejects non-positive limits', () => {
      const result = paginationLimit.safeParse(0)
      expect(result.success).toBe(false)
    })
  })

  describe('paginationCursor', () => {
    it('accepts a valid cursor', () => {
      const result = paginationCursor.safeParse(VALID_OID)
      expect(result.success).toBe(true)
    })

    it('allows undefined', () => {
      const result = paginationCursor.safeParse(undefined)
      expect(result.success).toBe(true)
    })

    it('rejects invalid cursor format', () => {
      const result = paginationCursor.safeParse('not-a-cursor')
      expect(result.success).toBe(false)
    })
  })

  describe('optionalString', () => {
    const schema = optionalString(100)

    it('accepts a trimmed string', () => {
      const result = schema.safeParse('  hello  ')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('hello')
      }
    })

    it('normalises empty string to undefined', () => {
      const result = schema.safeParse('')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeUndefined()
      }
    })

    it('normalises null and undefined to undefined', () => {
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    })

    it('rejects strings over max length', () => {
      const result = schema.safeParse('x'.repeat(101))
      expect(result.success).toBe(false)
    })
  })

  describe('isoDate', () => {
    it('coerces ISO date strings to Date', () => {
      const result = isoDate.safeParse('2025-06-01')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date)
      }
    })

    it('accepts Date instances', () => {
      const result = isoDate.safeParse(new Date('2025-06-01'))
      expect(result.success).toBe(true)
    })

    it('rejects invalid date strings', () => {
      const result = isoDate.safeParse('not-a-date')
      expect(result.success).toBe(false)
    })
  })
})
