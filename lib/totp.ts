/**
 * Tiny RFC 6238 (TOTP) + RFC 4648 (base32) implementation.
 *
 * Self-contained on top of `node:crypto` so we don't have to take on
 * `otplib` / `speakeasy` / `@otplib/*` just for one feature. The math is
 * well-defined and compact — easier to audit than vendoring a library.
 *
 * Compatibility: SHA-1, 6-digit, 30-second window — same defaults as
 * Google Authenticator, 1Password, Authy, Bitwarden, etc.
 */

import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DIGITS = 6
const PERIOD = 30
const ALGO = 'sha1'

/** Encode a Buffer as RFC 4648 base32 (no padding). */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return out
}

/** Decode an RFC 4648 base32 string (with or without padding) to a Buffer. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const c of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(c)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Generate a cryptographically strong base32 secret (160 bits = 32 chars). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

/** Compute the HOTP code for a given counter (RFC 4226). */
function hotp(secret: Buffer, counter: number): string {
  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8)
  // JS bitwise ops are 32-bit; split the counter into hi/lo halves so
  // we don't lose precision for distant time windows.
  const hi = Math.floor(counter / 2 ** 32)
  const lo = counter >>> 0
  buf.writeUInt32BE(hi, 0)
  buf.writeUInt32BE(lo, 4)

  const hmac = crypto.createHmac(ALGO, secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 *
 * `windowSteps` controls clock-skew tolerance: 1 means accept the
 * previous, current, and next 30s windows (default). Matches what
 * Google Authenticator's verify-side does.
 *
 * Returns `false` for no match, or the matched HOTP counter step when
 * the code is accepted. Callers use the returned step with the
 * companion `recordTotpStep` cache so the same code can't be replayed
 * inside the same skew window.
 */
export function verifyTotpStep(secret: string, code: string, windowSteps = 1): number | null {
  if (!secret || !code) return null
  const normalized = code.replace(/\D/g, '')
  if (normalized.length !== DIGITS) return null

  const key = base32Decode(secret)
  if (key.length === 0) return null

  const t = Math.floor(Date.now() / 1000 / PERIOD)
  for (let i = -windowSteps; i <= windowSteps; i++) {
    const candidate = hotp(key, t + i)
    if (timingSafeEqualStr(candidate, normalized)) return t + i
  }
  return null
}

/**
 * Boolean facade — preserves the original `verifyTotp` API for callers
 * that don't need replay protection (eg the 2FA re-enrollment guard,
 * which already requires a fresh password).
 */
export function verifyTotp(secret: string, code: string, windowSteps = 1): boolean {
  return verifyTotpStep(secret, code, windowSteps) !== null
}

/** Current TOTP code for a base32 secret (tests and diagnostics). */
export function generateTotpCode(secret: string, at = Date.now()): string {
  const key = base32Decode(secret)
  const counter = Math.floor(at / 1000 / PERIOD)
  return hotp(key, counter)
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Build the otpauth:// URI consumed by authenticator apps.
 * Issuer + account label both end up displayed in the app.
 */
export function buildOtpauthUrl(args: {
  secret: string
  accountName: string
  issuer: string
}): string {
  const label = encodeURIComponent(`${args.issuer}:${args.accountName}`)
  const params = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * Generate `count` cryptographically random backup codes formatted as
 * `XXXX-XXXX` (10 chars from a 32-char alphabet ≈ 50 bits each).
 */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ' // omit 0, O, 1, I, L
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    let s = ''
    for (let j = 0; j < 8; j++) s += alphabet[crypto.randomInt(alphabet.length)]
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`)
  }
  return codes
}
