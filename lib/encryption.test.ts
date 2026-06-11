import { setNodeEnv } from '@/lib/test/type-helpers'
import { describe, expect, it, afterEach, vi } from 'vitest'
import * as encryption from './encryption'

describe('encryption', () => {
  const prevEnc = process.env.ENCRYPTION_KEY
  const prevAuth = process.env.NEXTAUTH_SECRET
  const prevNode = process.env.NODE_ENV

  afterEach(() => {
    if (prevEnc === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = prevEnc
    if (prevAuth === undefined) delete process.env.NEXTAUTH_SECRET
    else process.env.NEXTAUTH_SECRET = prevAuth
    setNodeEnv(prevNode
)
  })

  it('round-trips plaintext', () => {
    process.env.ENCRYPTION_KEY = 'test-key-for-unit-tests-only'
    const cipher = encryption.encrypt('smtp-password')
    expect(cipher.startsWith('enc:v1:')).toBe(true)
    expect(encryption.decrypt(cipher)).toBe('smtp-password')
  })

  it('passes through empty and already-encrypted values', () => {
    process.env.ENCRYPTION_KEY = 'test-key'
    expect(encryption.encrypt('')).toBe('')
    const once = encryption.encrypt('x')
    expect(encryption.encrypt(once)).toBe(once)
    expect(encryption.decrypt('legacy-plain')).toBe('legacy-plain')
  })

  it('safeDecrypt surfaces operator-facing errors', () => {
    process.env.ENCRYPTION_KEY = 'test-key'
    const bad = 'enc:v1:aaaa:bbbb:cccc'
    const res = encryption.safeDecrypt(bad)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(encryption.decryptFailureMessage(res.reason)).toMatch(/decrypt/i)
    }
  })

  it('safeDecrypt returns key_missing when decrypt cites ENCRYPTION_KEY', () => {
    const prevNode = process.env.NODE_ENV
    const prevEnc = process.env.ENCRYPTION_KEY
    setNodeEnv('production'
)
    delete process.env.ENCRYPTION_KEY

    const res = encryption.safeDecrypt('enc:v1:aaaa:bbbb:cccc')
    expect(res).toEqual({ ok: false, reason: 'key_missing' })
    expect(encryption.decryptFailureMessage('key_missing')).toContain('ENCRYPTION_KEY')

    setNodeEnv(prevNode
)
    if (prevEnc === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = prevEnc
  })

  it('requires ENCRYPTION_KEY in production', () => {
    setNodeEnv('production'
)
    delete process.env.ENCRYPTION_KEY
    expect(() => encryption.encrypt('x')).toThrow(/ENCRYPTION_KEY/)
  })

  it('falls back to NEXTAUTH_SECRET in development when ENCRYPTION_KEY is unset', async () => {
    vi.resetModules()
    delete process.env.ENCRYPTION_KEY
    setNodeEnv('development'
)
    process.env.NEXTAUTH_SECRET = 'dev-only-nextauth-fallback-key'

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { encrypt: enc, decrypt: dec } = await import('./encryption')

    const cipher = enc('smtp-password')
    expect(cipher.startsWith('enc:v1:')).toBe(true)
    expect(dec(cipher)).toBe('smtp-password')
    expect(warn).toHaveBeenCalledWith(
      '[encryption] ENCRYPTION_KEY not set; falling back to NEXTAUTH_SECRET (development only).',
    )

    warn.mockRestore()
    process.env.ENCRYPTION_KEY = 'test-encryption-key-do-not-use-1234'
    vi.resetModules()
  })

  it('throws when neither ENCRYPTION_KEY nor NEXTAUTH_SECRET is set in dev', async () => {
    vi.resetModules()
    delete process.env.ENCRYPTION_KEY
    delete process.env.NEXTAUTH_SECRET
    setNodeEnv('development'
)

    const { encrypt: enc } = await import('./encryption')
    expect(() => enc('x')).toThrow(/ENCRYPTION_KEY \(or NEXTAUTH_SECRET fallback in dev\)/)

    process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use'
    vi.resetModules()
  })
})
