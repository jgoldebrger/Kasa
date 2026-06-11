import { describe, expect, it, afterEach, vi } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => null),
}))

import { getPlatformAdminEmails, isPlatformAdminEmail } from './platform-admin'

describe('isPlatformAdminEmail', () => {
  const prev = process.env.PLATFORM_ADMIN_EMAILS

  afterEach(() => {
    if (prev === undefined) delete process.env.PLATFORM_ADMIN_EMAILS
    else process.env.PLATFORM_ADMIN_EMAILS = prev
  })

  it('returns false when env is empty', () => {
    process.env.PLATFORM_ADMIN_EMAILS = ''
    expect(isPlatformAdminEmail('admin@example.com')).toBe(false)
    expect(isPlatformAdminEmail(null)).toBe(false)
  })

  it('matches comma-separated emails case-insensitively', () => {
    process.env.PLATFORM_ADMIN_EMAILS = ' Admin@Example.com , other@test.com '
    expect(isPlatformAdminEmail('admin@example.com')).toBe(true)
    expect(isPlatformAdminEmail('other@test.com')).toBe(true)
    expect(isPlatformAdminEmail('nope@test.com')).toBe(false)
  })
})

describe('getPlatformAdminEmails', () => {
  const prev = process.env.PLATFORM_ADMIN_EMAILS

  afterEach(() => {
    if (prev === undefined) delete process.env.PLATFORM_ADMIN_EMAILS
    else process.env.PLATFORM_ADMIN_EMAILS = prev
  })

  it('returns trimmed comma-separated emails', () => {
    process.env.PLATFORM_ADMIN_EMAILS = ' Admin@Example.com , other@test.com '
    expect(getPlatformAdminEmails()).toEqual(['Admin@Example.com', 'other@test.com'])
  })

  it('returns empty array when unset', () => {
    process.env.PLATFORM_ADMIN_EMAILS = ''
    expect(getPlatformAdminEmails()).toEqual([])
  })
})
