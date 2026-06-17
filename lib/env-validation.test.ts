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
})
