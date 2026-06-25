import { describe, expect, it } from 'vitest'
import { normalizeMemberEmail, userEmailMatchesFamily } from '@/lib/member-family-access'

describe('normalizeMemberEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeMemberEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })
})

describe('userEmailMatchesFamily', () => {
  it('matches family email', () => {
    expect(
      userEmailMatchesFamily('husband@example.com', { email: 'Husband@Example.com' }, []),
    ).toBe(true)
  })

  it('matches member email', () => {
    expect(
      userEmailMatchesFamily('child@example.com', { email: 'other@example.com' }, [
        { email: 'child@example.com' },
      ]),
    ).toBe(true)
  })

  it('rejects unrelated email', () => {
    expect(
      userEmailMatchesFamily('stranger@example.com', { email: 'family@example.com' }, [
        { email: 'member@example.com' },
      ]),
    ).toBe(false)
  })
})
