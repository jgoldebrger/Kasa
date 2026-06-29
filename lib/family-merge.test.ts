import { describe, expect, it } from 'vitest'
import { isFamilyDescendantOf } from '@/lib/family-sub-tree'

describe('isFamilyDescendantOf', () => {
  it('returns true when ids match', async () => {
    const result = await isFamilyDescendantOf('org', 'a', 'a')
    expect(result).toBe(true)
  })
})

describe('family merge validation', () => {
  it('rejects merging a family into itself', async () => {
    const { validateFamilyMerge } = await import('@/lib/family-merge')
    const result = await validateFamilyMerge('507f1f77bcf86cd799439011', 'same', 'same')
    expect(result).toEqual({ ok: false, error: 'Cannot merge a family into itself' })
  })
})
