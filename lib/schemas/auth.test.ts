import { describe, expect, it } from 'vitest'
import {
  acceptInviteBody,
  changePasswordBody,
  inviteUserBody,
  requestInviteBody,
  resetPasswordConfirmBody,
  resetPasswordRequestBody,
  signupBody,
  updateProfileBody,
} from './auth'

const VALID_OID = '507f1f77bcf86cd799439011'
const STRONG_PASSWORD = 'StrongPassword1!'

describe('auth schemas', () => {
  describe('signupBody', () => {
    it('accepts a valid signup payload', () => {
      const result = signupBody.safeParse({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: STRONG_PASSWORD,
        inviteCode: 'INVITE-123',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing invite code', () => {
      const result = signupBody.safeParse({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: STRONG_PASSWORD,
      })
      expect(result.success).toBe(false)
    })

    it('rejects weak passwords', () => {
      const result = signupBody.safeParse({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
        inviteCode: 'INVITE-123',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('requestInviteBody', () => {
    it('accepts a valid invite request', () => {
      const result = requestInviteBody.safeParse({
        name: 'Jane Doe',
        email: 'jane@example.com',
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional organization and message', () => {
      const result = requestInviteBody.safeParse({
        name: 'Jane Doe',
        email: 'jane@example.com',
        organization: 'Temple Beth',
        message: 'We would like to join.',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing name', () => {
      const result = requestInviteBody.safeParse({
        email: 'jane@example.com',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('acceptInviteBody', () => {
    it('accepts token-only acceptance', () => {
      const result = acceptInviteBody.safeParse({
        token: 'abc123token',
      })
      expect(result.success).toBe(true)
    })

    it('accepts token with name and password', () => {
      const result = acceptInviteBody.safeParse({
        token: 'abc123token',
        name: 'Jane Doe',
        password: STRONG_PASSWORD,
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty token', () => {
      const result = acceptInviteBody.safeParse({ token: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('resetPasswordRequestBody', () => {
    it('accepts a valid email', () => {
      const result = resetPasswordRequestBody.safeParse({
        email: 'user@example.com',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid email', () => {
      const result = resetPasswordRequestBody.safeParse({
        email: 'not-email',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('resetPasswordConfirmBody', () => {
    it('accepts token and strong new password', () => {
      const result = resetPasswordConfirmBody.safeParse({
        token: 'reset-token-xyz',
        newPassword: STRONG_PASSWORD,
      })
      expect(result.success).toBe(true)
    })

    it('rejects weak new password', () => {
      const result = resetPasswordConfirmBody.safeParse({
        token: 'reset-token-xyz',
        newPassword: 'weak',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing token', () => {
      const result = resetPasswordConfirmBody.safeParse({
        newPassword: STRONG_PASSWORD,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('changePasswordBody', () => {
    it('accepts current and new passwords', () => {
      const result = changePasswordBody.safeParse({
        currentPassword: 'OldPass123!',
        newPassword: STRONG_PASSWORD,
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty current password', () => {
      const result = changePasswordBody.safeParse({
        currentPassword: '',
        newPassword: STRONG_PASSWORD,
      })
      expect(result.success).toBe(false)
    })

    it('rejects weak new password', () => {
      const result = changePasswordBody.safeParse({
        currentPassword: 'OldPass123!',
        newPassword: 'short',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('updateProfileBody', () => {
    it('accepts an empty partial update', () => {
      const result = updateProfileBody.safeParse({})
      expect(result.success).toBe(true)
    })

    it('accepts a name update', () => {
      const result = updateProfileBody.safeParse({ name: 'New Name' })
      expect(result.success).toBe(true)
    })

    it('rejects empty name when provided', () => {
      const result = updateProfileBody.safeParse({ name: '   ' })
      expect(result.success).toBe(false)
    })
  })

  describe('inviteUserBody', () => {
    it('accepts email and role', () => {
      const result = inviteUserBody.safeParse({
        email: 'member@example.com',
        role: 'member',
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional organizationId', () => {
      const result = inviteUserBody.safeParse({
        email: 'member@example.com',
        role: 'admin',
        organizationId: VALID_OID,
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid role', () => {
      const result = inviteUserBody.safeParse({
        email: 'member@example.com',
        role: 'superuser',
      })
      expect(result.success).toBe(false)
    })
  })
})
