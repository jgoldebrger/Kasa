import { describe, expect, it } from 'vitest'
import { sentryBeforeSend } from './sentry-scrub'

describe('sentryBeforeSend', () => {
  it('redacts sensitive keys and PII in messages', () => {
    const event = sentryBeforeSend({
      message: 'user@secret.com paid with pi_abc_secret_xyz',
      request: {
        headers: { authorization: 'Bearer tok', cookie: 'a=b' },
        data: { password: 'pw', nested: { token: 't' } },
      },
      user: { id: 'u1', email: 'user@secret.com', ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'reset /reset-password/abc123token', data: { ccinfo: '4111' } }],
      exception: { values: [{ value: 'card 4111 1111 1111 1111' }] },
    })

    expect(event.message).toContain('[redacted-email]')
    expect(event.request.headers.authorization).toBe('[redacted]')
    expect(event.request.data.password).toBe('[redacted]')
    expect(event.user).toEqual({ id: 'u1' })
    expect(event.breadcrumbs[0].message).toContain('[redacted]')
    expect(event.exception.values[0].value).toContain('[redacted-card]')
  })

  it('does not throw on deeply nested events', () => {
    const deep: Record<string, unknown> = { v: 'x' }
    let cur: Record<string, unknown> = deep
    for (let i = 0; i < 10; i++) {
      cur = { nested: cur }
    }
    expect(() => sentryBeforeSend({ contexts: cur })).not.toThrow()
  })
})
