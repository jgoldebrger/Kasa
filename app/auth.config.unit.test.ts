import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import authConfig from './auth.config'

const authorized = authConfig.callbacks!.authorized!

function apiRequest(
  path: string,
  headers: Record<string, string> = {},
): Parameters<typeof authorized>[0]['request'] {
  const h = new Headers(headers)
  return {
    nextUrl: new URL(`https://app.test${path}`),
    headers: h,
  } as unknown as Parameters<typeof authorized>[0]['request']
}

describe('auth.config authorized — cron secret middleware gate', () => {
  const prevSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevSecret
  })

  it('returns 401 for protected API when x-cron-secret is invalid', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', { 'x-cron-secret': 'wrong-secret' }),
    })

    expect(result).not.toBe(true)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 for protected API when Bearer token is invalid', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', {
        authorization: 'Bearer not-the-secret',
      }),
    })

    expect(result).not.toBe(true)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('allows protected API when cron secret is valid (x-cron-secret)', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', { 'x-cron-secret': 'test-cron-secret' }),
    })

    expect(result).toBe(true)
  })

  it('allows protected API when cron secret is valid (Bearer)', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', {
        authorization: 'Bearer test-cron-secret',
      }),
    })

    expect(result).toBe(true)
  })

  it('does not treat bare Bearer prefix as cron auth', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', { authorization: 'Bearer ' }),
    })

    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })

  it('does not treat empty x-cron-secret as valid cron auth', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', { 'x-cron-secret': '' }),
    })

    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })
})
