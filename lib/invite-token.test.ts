import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const mockFindOne = vi.fn()

vi.mock('@/lib/models', () => ({
  Invite: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
}))

describe('invite-token', () => {
  beforeEach(() => {
    mockFindOne.mockReset()
  })

  describe('hashInviteToken', () => {
    it('returns a 64-char SHA-256 hex digest', async () => {
      const { hashInviteToken } = await import('./invite-token')
      const hash = hashInviteToken('test-bearer-token')
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
      expect(hash).toBe(crypto.createHash('sha256').update('test-bearer-token').digest('hex'))
    })

    it('is deterministic for the same input', async () => {
      const { hashInviteToken } = await import('./invite-token')
      expect(hashInviteToken('same-token')).toBe(hashInviteToken('same-token'))
    })
  })

  describe('inviteTokenFromUrl', () => {
    it('extracts token from invite URL path', async () => {
      const { inviteTokenFromUrl } = await import('./invite-token')
      expect(inviteTokenFromUrl('http://localhost:3000/invite/abc123')).toBe('abc123')
      expect(inviteTokenFromUrl('https://kasa.example.com/invite/foo%2Bbar')).toBe('foo+bar')
    })

    it('throws for invalid invite URLs', async () => {
      const { inviteTokenFromUrl } = await import('./invite-token')
      expect(() => inviteTokenFromUrl('http://localhost:3000/settings')).toThrow(
        'Invalid invite URL',
      )
    })
  })

  describe('findInviteByToken', () => {
    it('looks up hashed token first, then legacy plaintext', async () => {
      const { hashInviteToken, findInviteByToken } = await import('./invite-token')
      const plain = 'legacy-or-new-token'
      const hashedDoc = { _id: 'hashed' }
      const plainDoc = { _id: 'plain' }

      mockFindOne.mockResolvedValueOnce(hashedDoc)
      await expect(findInviteByToken(plain)).resolves.toBe(hashedDoc)
      expect(mockFindOne).toHaveBeenNthCalledWith(1, { token: hashInviteToken(plain) })
      expect(mockFindOne).toHaveBeenCalledTimes(1)

      mockFindOne.mockReset()
      mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(plainDoc)
      await expect(findInviteByToken(plain)).resolves.toBe(plainDoc)
      expect(mockFindOne).toHaveBeenNthCalledWith(1, { token: hashInviteToken(plain) })
      expect(mockFindOne).toHaveBeenNthCalledWith(2, { token: plain })
    })
  })

  describe('findInviteByTokenLean', () => {
    it('uses lean queries for hashed then legacy tokens', async () => {
      const { hashInviteToken, findInviteByTokenLean } = await import('./invite-token')
      const plain = 'resolve-token'
      const doc = { email: 'a@b.com' }
      const lean = vi.fn().mockResolvedValueOnce(doc)

      mockFindOne.mockReturnValueOnce({ lean })

      await expect(findInviteByTokenLean(plain)).resolves.toEqual(doc)
      expect(mockFindOne).toHaveBeenCalledWith({ token: hashInviteToken(plain) })
      expect(lean).toHaveBeenCalled()
    })
  })
})
