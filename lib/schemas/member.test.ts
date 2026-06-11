import { describe, expect, it } from 'vitest'
import { addMemberBody, removeMemberQuery, updateMemberRoleBody } from './member'

const VALID_OID = '507f1f77bcf86cd799439011'

describe('member schemas', () => {
  describe('addMemberBody', () => {
    it('accepts email and role', () => {
      const result = addMemberBody.safeParse({
        email: 'newmember@example.com',
        role: 'member',
      })
      expect(result.success).toBe(true)
    })

    it('accepts owner and admin roles', () => {
      expect(addMemberBody.safeParse({ email: 'a@example.com', role: 'owner' }).success).toBe(
        true,
      )
      expect(addMemberBody.safeParse({ email: 'b@example.com', role: 'admin' }).success).toBe(
        true,
      )
    })

    it('rejects invalid role', () => {
      const result = addMemberBody.safeParse({
        email: 'user@example.com',
        role: 'guest',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid email', () => {
      const result = addMemberBody.safeParse({
        email: 'not-email',
        role: 'member',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('updateMemberRoleBody', () => {
    it('accepts a valid role update', () => {
      const result = updateMemberRoleBody.safeParse({ role: 'admin' })
      expect(result.success).toBe(true)
    })

    it('rejects invalid role', () => {
      const result = updateMemberRoleBody.safeParse({ role: 'viewer' })
      expect(result.success).toBe(false)
    })

    it('rejects missing role', () => {
      const result = updateMemberRoleBody.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('removeMemberQuery', () => {
    it('accepts a valid membershipId', () => {
      const result = removeMemberQuery.safeParse({
        membershipId: VALID_OID,
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid membershipId', () => {
      const result = removeMemberQuery.safeParse({
        membershipId: 'short',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing membershipId', () => {
      const result = removeMemberQuery.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
