import { describe, expect, it, afterEach } from 'vitest'
import { verifyApiCsrf } from './csrf'

describe('verifyApiCsrf', () => {
  const prevCron = process.env.CRON_SECRET

  afterEach(() => {
    if (prevCron === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevCron
  })

  it('allows safe methods', () => {
    const req = new Request('http://localhost/api/families', { method: 'GET' })
    expect(verifyApiCsrf(req)).toBeNull()
  })

  it('allows same-origin POST', () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost' },
    })
    expect(verifyApiCsrf(req)).toBeNull()
  })

  it('blocks cross-origin POST', async () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://evil.test' },
    })
    const res = verifyApiCsrf(req)
    expect(res?.status).toBe(403)
    await expect(res?.json()).resolves.toMatchObject({
      error: expect.stringContaining('Cross-site'),
    })
  })

  it('blocks POST without origin or referer', async () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost' },
    })
    const res = verifyApiCsrf(req)
    expect(res?.status).toBe(403)
  })

  it('skips NextAuth and Stripe webhook paths', () => {
    expect(
      verifyApiCsrf(
        new Request('http://localhost/api/auth/callback/credentials', { method: 'POST' }),
      ),
    ).toBeNull()
    expect(
      verifyApiCsrf(new Request('http://localhost/api/stripe/webhook', { method: 'POST' })),
    ).toBeNull()
  })

  it('accepts cron secret header', () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    const req = new Request('http://localhost/api/jobs/cycle-rollover', {
      method: 'POST',
      headers: { 'x-cron-secret': 'cron-test-secret' },
    })
    expect(verifyApiCsrf(req)).toBeNull()
  })

  it('accepts cron bearer token', () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    const req = new Request('http://localhost/api/jobs/cycle-rollover', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-test-secret' },
    })
    expect(verifyApiCsrf(req)).toBeNull()
  })

  it('allows same-origin POST via Referer when Origin is absent', () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost', referer: 'http://localhost/dashboard' },
    })
    expect(verifyApiCsrf(req)).toBeNull()
  })

  it('blocks cross-site POST when only Referer is present', async () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost', referer: 'http://evil.test/phish' },
    })
    const res = verifyApiCsrf(req)
    expect(res?.status).toBe(403)
    await expect(res?.json()).resolves.toMatchObject({
      error: expect.stringContaining('Cross-site'),
    })
  })

  it('blocks POST when Referer is malformed', async () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost', referer: 'not-a-valid-url' },
    })
    const res = verifyApiCsrf(req)
    expect(res?.status).toBe(403)
  })

  it('blocks POST when Origin is malformed', async () => {
    const req = new Request('http://localhost/api/families', {
      method: 'POST',
      headers: { host: 'localhost', origin: '::::' },
    })
    const res = verifyApiCsrf(req)
    expect(res?.status).toBe(403)
  })

  it('skips non-API paths', () => {
    const req = new Request('http://localhost/dashboard', {
      method: 'POST',
      headers: { host: 'localhost' },
    })
    expect(verifyApiCsrf(req)).toBeNull()
  })
})
