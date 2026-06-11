import { describe, expect, it } from 'vitest'
import { emailConfigBody } from './email-config'

describe('email-config schemas', () => {
  describe('emailConfigBody', () => {
    it('accepts email only', () => {
      const result = emailConfigBody.safeParse({
        email: 'smtp@example.com',
      })
      expect(result.success).toBe(true)
    })

    it('accepts email with optional password and fromName', () => {
      const result = emailConfigBody.safeParse({
        email: 'smtp@example.com',
        password: 'app-specific-password',
        fromName: 'KASA Notifications',
      })
      expect(result.success).toBe(true)
    })

    it('normalises empty fromName to undefined', () => {
      const result = emailConfigBody.safeParse({
        email: 'smtp@example.com',
        fromName: '',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.fromName).toBeUndefined()
      }
    })

    it('rejects invalid email', () => {
      const result = emailConfigBody.safeParse({
        email: 'not-valid',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing email', () => {
      const result = emailConfigBody.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
