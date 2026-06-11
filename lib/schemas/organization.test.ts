import { describe, expect, it } from 'vitest'
import { organizationCreateBody, organizationSwitchBody } from './organization'

const VALID_OID = '507f1f77bcf86cd799439011'

describe('organization schemas', () => {
  describe('organizationCreateBody', () => {
    it('accepts a valid organization name', () => {
      const result = organizationCreateBody.safeParse({
        name: 'Temple Beth El',
      })
      expect(result.success).toBe(true)
    })

    it('rejects names shorter than 2 characters', () => {
      const result = organizationCreateBody.safeParse({
        name: 'A',
      })
      expect(result.success).toBe(false)
    })

    it('rejects empty name', () => {
      const result = organizationCreateBody.safeParse({
        name: '   ',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing name', () => {
      const result = organizationCreateBody.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('organizationSwitchBody', () => {
    it('accepts a valid activeOrgId', () => {
      const result = organizationSwitchBody.safeParse({
        activeOrgId: VALID_OID,
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid activeOrgId', () => {
      const result = organizationSwitchBody.safeParse({
        activeOrgId: 'not-valid',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing activeOrgId', () => {
      const result = organizationSwitchBody.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
