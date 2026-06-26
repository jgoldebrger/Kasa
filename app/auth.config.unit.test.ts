import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import authConfig, { CRON_API_PREFIXES } from './auth.config'

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

  it('returns 401 for non-cron API routes even when cron secret is valid', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/admin/reports', { 'x-cron-secret': 'test-cron-secret' }),
    })

    expect(result).not.toBe(true)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('allows cron API routes when cron secret is valid (x-cron-secret)', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/jobs/cycle-rollover', { 'x-cron-secret': 'test-cron-secret' }),
    })

    expect(result).toBe(true)
  })

  it('allows cron API routes when cron secret is valid (Bearer)', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/jobs/cycle-rollover', {
        authorization: 'Bearer test-cron-secret',
      }),
    })

    expect(result).toBe(true)
  })

  it('returns 401 for cron API routes without a valid secret', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/jobs/cycle-rollover'),
    })

    expect(result).not.toBe(true)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('does not treat bare Bearer prefix as cron auth', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/jobs/cycle-rollover', { authorization: 'Bearer ' }),
    })

    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })

  it('does not treat empty x-cron-secret as valid cron auth', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/jobs/cycle-rollover', { 'x-cron-secret': '' }),
    })

    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })

  it('exports CRON_API_PREFIXES covering job and org-or-cron worker routes', () => {
    expect(CRON_API_PREFIXES).toEqual(
      expect.arrayContaining([
        '/api/jobs',
        '/api/statements/auto-generate',
        '/api/recurring-payments/process',
        '/api/statements/send-emails/worker',
      ]),
    )
  })

  it('allows unauthenticated email tracking pixel requests', () => {
    const open = authorized({
      auth: null,
      request: apiRequest('/api/email/track/open/507f1f77bcf86cd799439011'),
    })
    expect(open).toBe(true)

    const click = authorized({
      auth: null,
      request: apiRequest(
        '/api/email/track/click/507f1f77bcf86cd799439011?u=aHR0cHM6Ly9leGFtcGxlLmNvbQ',
      ),
    })
    expect(click).toBe(true)
  })

  it('allows unauthenticated email unsubscribe requests', () => {
    const result = authorized({
      auth: null,
      request: apiRequest('/api/email/unsubscribe?token=abc'),
    })
    expect(result).toBe(true)
  })
})
