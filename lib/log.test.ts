import { setNodeEnv } from '@/lib/test/type-helpers'
import { describe, expect, it, afterEach, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'

describe('logError', () => {
  const prevNodeEnv = process.env.NODE_ENV
  const prevSentryDsn = process.env.SENTRY_DSN

  afterEach(() => {
    vi.resetModules()
    vi.mocked(Sentry.captureException).mockClear()
    if (prevNodeEnv === undefined)
      delete (process.env as Record<string, string | undefined>).NODE_ENV
    else setNodeEnv(prevNodeEnv)
    if (prevSentryDsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = prevSentryDsn
  })

  it('captures to Sentry in production when SENTRY_DSN is set', async () => {
    setNodeEnv('production')
    process.env.SENTRY_DSN = 'https://example@sentry.io/1'
    const { logError } = await import('./log')
    const err = new Error('unit test failure')
    logError(err, { module: 'log.test', tags: { area: 'unit' } })
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { area: 'unit' },
      extra: { module: 'log.test' },
    })
  })

  it('does not capture to Sentry without SENTRY_DSN', async () => {
    setNodeEnv('production')
    delete process.env.SENTRY_DSN
    const { logError } = await import('./log')
    logError(new Error('no dsn'))
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('scrubs secrets and emails from Sentry extra', async () => {
    setNodeEnv('production')
    process.env.SENTRY_DSN = 'https://example@sentry.io/1'
    const { logError } = await import('./log')
    const err = new Error('sensitive context')
    logError(err, {
      module: 'log.test',
      tags: { area: 'unit' },
      password: 'super-secret',
      attemptedEmail: 'user@secret.com',
      note: 'contact user@secret.com for help',
    })
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { area: 'unit' },
      extra: {
        module: 'log.test',
        password: '[redacted]',
        attemptedEmail: '[redacted-email]',
        note: 'contact [redacted-email] for help',
      },
    })
  })
})
