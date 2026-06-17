import { setNodeEnv } from '@/lib/test/type-helpers'
import { describe, expect, it, afterEach, vi } from 'vitest'
import {
  shouldValidateProductionEnv,
  validateProductionEnv,
  __resetEnvValidationForTests,
} from './env-validation'

describe('env-validation', () => {
  const prevEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...prevEnv }
    setNodeEnv(prevEnv.NODE_ENV)
    vi.resetModules()
    __resetEnvValidationForTests()
  })

  it('skips validation outside production', () => {
    setNodeEnv('test')
    expect(shouldValidateProductionEnv()).toBe(false)
    expect(() => validateProductionEnv()).not.toThrow()
  })

  it('skips validation when VITEST is set even in production NODE_ENV', () => {
    setNodeEnv('production')
    process.env.VITEST = 'true'
    expect(shouldValidateProductionEnv()).toBe(false)
    delete process.env.CRON_SECRET
    expect(() => validateProductionEnv()).not.toThrow()
  })

  it('throws with clear errors when production secrets are missing or too short', () => {
    setNodeEnv('production')
    delete process.env.VITEST
    delete process.env.CRON_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET
    delete process.env.MONGODB_URI
    delete process.env.ENCRYPTION_KEY

    expect(() => validateProductionEnv()).toThrow(/Production environment validation failed/)
    try {
      validateProductionEnv()
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('CRON_SECRET')
      expect(msg).toContain('NEXTAUTH_SECRET or AUTH_SECRET')
      expect(msg).toContain('MONGODB_URI')
      expect(msg).toContain('ENCRYPTION_KEY')
    }
  })

  it('passes when production env vars meet requirements', () => {
    setNodeEnv('production')
    delete process.env.VITEST
    process.env.CRON_SECRET = 'a'.repeat(32)
    process.env.NEXTAUTH_SECRET = 'b'.repeat(16)
    process.env.MONGODB_URI = 'mongodb://localhost:27017/kasa'
    process.env.ENCRYPTION_KEY = 'c'.repeat(32)

    expect(() => validateProductionEnv()).not.toThrow()
  })

  it('warns once when Upstash rate-limit vars are missing in production', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    setNodeEnv('production')
    delete process.env.VITEST
    process.env.CRON_SECRET = 'a'.repeat(32)
    process.env.NEXTAUTH_SECRET = 'b'.repeat(16)
    process.env.MONGODB_URI = 'mongodb://localhost:27017/kasa'
    process.env.ENCRYPTION_KEY = 'c'.repeat(32)
    process.env.SENTRY_DSN = 'https://example@sentry.io/1'
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN

    validateProductionEnv()
    validateProductionEnv()

    const upstashWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('UPSTASH_REDIS_REST'),
    )
    expect(upstashWarnings).toHaveLength(1)
    expect(upstashWarnings[0][0]).toMatch(/MongoDB/)
    warnSpy.mockRestore()
  })

  it('does not warn about Upstash when both vars are set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    setNodeEnv('production')
    delete process.env.VITEST
    process.env.CRON_SECRET = 'a'.repeat(32)
    process.env.NEXTAUTH_SECRET = 'b'.repeat(16)
    process.env.MONGODB_URI = 'mongodb://localhost:27017/kasa'
    process.env.ENCRYPTION_KEY = 'c'.repeat(32)
    process.env.SENTRY_DSN = 'https://example@sentry.io/1'
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'

    validateProductionEnv()

    const upstashWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('UPSTASH_REDIS_REST'),
    )
    expect(upstashWarnings).toHaveLength(0)
    warnSpy.mockRestore()
  })

  it('warns once when SENTRY_DSN is missing in production', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    setNodeEnv('production')
    delete process.env.VITEST
    process.env.CRON_SECRET = 'a'.repeat(32)
    process.env.NEXTAUTH_SECRET = 'b'.repeat(16)
    process.env.MONGODB_URI = 'mongodb://localhost:27017/kasa'
    process.env.ENCRYPTION_KEY = 'c'.repeat(32)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    delete process.env.SENTRY_DSN

    validateProductionEnv()
    validateProductionEnv()

    const sentryWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('SENTRY_DSN'),
    )
    expect(sentryWarnings).toHaveLength(1)
    expect(sentryWarnings[0][0]).toMatch(/observability gap/)
    warnSpy.mockRestore()
  })
})
