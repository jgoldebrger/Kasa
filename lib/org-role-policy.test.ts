import { describe, expect, it } from 'vitest'
import { canAssignOrgRole, canMutateMemberRole } from '@/lib/org-role-policy'

describe('org-role-policy', () => {
  describe('canAssignOrgRole', () => {
    it('allows only owners to assign owner', () => {
      expect(canAssignOrgRole('owner', 'owner')).toBe(true)
      expect(canAssignOrgRole('admin', 'owner')).toBe(false)
      expect(canAssignOrgRole('member', 'owner')).toBe(false)
      expect(canAssignOrgRole('treasurer', 'owner')).toBe(false)
    })

    it('allows owners and admins to assign admin and specialist roles', () => {
      for (const actor of ['owner', 'admin'] as const) {
        expect(canAssignOrgRole(actor, 'admin')).toBe(true)
        expect(canAssignOrgRole(actor, 'member')).toBe(true)
        expect(canAssignOrgRole(actor, 'treasurer')).toBe(true)
        expect(canAssignOrgRole(actor, 'communications')).toBe(true)
      }
    })

    it('denies members and specialists from assigning elevated roles', () => {
      for (const actor of ['member', 'treasurer', 'communications'] as const) {
        expect(canAssignOrgRole(actor, 'admin')).toBe(false)
        expect(canAssignOrgRole(actor, 'member')).toBe(false)
      }
    })
  })

  describe('canMutateMemberRole', () => {
    it('blocks non-owners from changing an owner', () => {
      expect(canMutateMemberRole('admin', 'owner')).toBe(false)
      expect(canMutateMemberRole('member', 'owner')).toBe(false)
      expect(canMutateMemberRole('owner', 'owner')).toBe(true)
    })

    it('allows admins to change non-owner members', () => {
      expect(canMutateMemberRole('admin', 'admin')).toBe(true)
      expect(canMutateMemberRole('admin', 'member')).toBe(true)
      expect(canMutateMemberRole('admin', 'treasurer')).toBe(true)
    })
  })
})
