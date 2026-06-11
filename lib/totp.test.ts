import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  verifyTotp,
  verifyTotpStep,
} from './totp'

describe('base32', () => {
  it('round-trips buffers', () => {
    const buf = Buffer.from('hello totp')
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })

  it('pads the final partial quintet when bit length is not a multiple of 5', () => {
    expect(base32Encode(Buffer.from([0xff]))).toBe('74')
    expect(base32Encode(Buffer.from([0x00, 0x00, 0x01]))).toHaveLength(5)
  })
})

describe('verifyTotp', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts the code for the current time window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
    const secret = generateTotpSecret()
    let match: string | null = null
    for (let i = 0; i < 1_000_000; i++) {
      const code = String(i).padStart(6, '0')
      if (verifyTotp(secret, code)) {
        match = code
        break
      }
    }
    expect(match).toMatch(/^\d{6}$/)
    expect(verifyTotpStep(secret, match!)).toBeTypeOf('number')
  })

  it('rejects invalid codes', () => {
    expect(verifyTotp('', '123456')).toBe(false)
    expect(verifyTotp('JBSWY3DPEEBKIWFOYAQCEKRCKU4D3MX7', '12')).toBe(false)
    expect(verifyTotp('!!!!', '123456')).toBe(false)
  })
})

describe('generateTotpSecret', () => {
  it('returns base32 of expected length', () => {
    expect(generateTotpSecret()).toHaveLength(32)
  })
})

describe('generateTotpCode', () => {
  it('matches verifyTotp for the same instant', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
    const secret = generateTotpSecret()
    const code = generateTotpCode(secret)
    expect(verifyTotp(secret, code)).toBe(true)
    vi.useRealTimers()
  })
})

describe('buildOtpauthUrl', () => {
  it('builds an otpauth URI', () => {
    const url = buildOtpauthUrl({
      secret: 'ABCDEF',
      accountName: 'user@example.com',
      issuer: 'Kasa',
    })
    expect(url).toMatch(/^otpauth:\/\/totp\//)
    expect(url).toContain('secret=ABCDEF')
  })
})

describe('generateBackupCodes', () => {
  it('formats codes as XXXX-XXXX', () => {
    const codes = generateBackupCodes(3)
    expect(codes).toHaveLength(3)
    for (const c of codes) expect(c).toMatch(/^[23456789A-Z]{4}-[23456789A-Z]{4}$/)
  })
})
