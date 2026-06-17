/**
 * AES-256-GCM encryption for secrets at rest (e.g. EmailConfig.password).
 *
 * Keyed off ENCRYPTION_KEY env var (32-byte key, base64-encoded). Tolerates
 * NEXTAUTH_SECRET as a fallback so existing deployments don't break — but
 * ENCRYPTION_KEY should be set explicitly in production.
 *
 * Format of an encrypted value: `enc:v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>`
 * Plaintext values (no `enc:` prefix) are passed through unchanged, which
 * lets us roll out encryption gradually without breaking existing rows.
 */

import crypto from 'crypto'

export const ENCRYPTION_PREFIX = 'enc:v1:'
const PREFIX = ENCRYPTION_PREFIX
const ALGO = 'aes-256-gcm'

/** True when a non-empty value is stored without the `enc:v1:` envelope. */
export function isLegacyPlaintextSecret(value: string | null | undefined): boolean {
  if (value == null || value === '') return false
  return !value.startsWith(PREFIX)
}

function rejectLegacyPlaintext2FAEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.REJECT_LEGACY_PLAINTEXT_2FA === 'true'
}

// Cached fallback warning flags — keeps logs quiet on every call.
let warnedFallback = false
let warnedLegacyPlaintext = false

function warnLegacyPlaintextOnce(): void {
  if (process.env.NODE_ENV !== 'production' || warnedLegacyPlaintext) return
  warnedLegacyPlaintext = true
  console.warn(
    '[encryption] Legacy plaintext secret detected at rest. Re-save affected records ' +
      '(email settings, 2FA) or see docs/SECURITY.md — "Encrypting legacy plaintext secrets".',
  )
}

function getKey(): Buffer {
  const encKey = process.env.ENCRYPTION_KEY
  if (!encKey) {
    if (process.env.NODE_ENV === 'production') {
      // Don't silently couple two security domains in production. Having
      // a distinct ENCRYPTION_KEY means rotating the session secret (or
      // having it leak) doesn't compromise email passwords + TOTP
      // secrets at rest as well.
      throw new Error(
        'ENCRYPTION_KEY is required in production. Set a dedicated 32-byte key (base64 ok); do not reuse NEXTAUTH_SECRET.',
      )
    }
    const fallback = process.env.NEXTAUTH_SECRET
    if (!fallback) {
      throw new Error('ENCRYPTION_KEY (or NEXTAUTH_SECRET fallback in dev) is not set')
    }
    if (!warnedFallback) {
      console.warn(
        '[encryption] ENCRYPTION_KEY not set; falling back to NEXTAUTH_SECRET (development only).',
      )
      warnedFallback = true
    }
    return crypto.createHash('sha256').update(fallback).digest()
  }
  // Accept either a base64 string or a raw string; derive a stable 32-byte
  // key via SHA-256.
  return crypto.createHash('sha256').update(encKey).digest()
}

export function encrypt(plaintext: string): string {
  if (plaintext == null || plaintext === '') return plaintext
  if (plaintext.startsWith(PREFIX)) return plaintext // already encrypted
  const key = getKey()
  const iv = crypto.randomBytes(12) // GCM standard nonce length
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 })
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export type DecryptOptions = {
  /** When true, refuse legacy plaintext instead of pass-through (2FA hardening). */
  rejectLegacyPlaintext?: boolean
}

export function decrypt(value: string, options?: DecryptOptions): string {
  if (value == null || value === '') return value
  if (!value.startsWith(PREFIX)) {
    if (options?.rejectLegacyPlaintext) {
      throw new Error(
        'Legacy plaintext secret rejected. Run `npx tsx scripts/encrypt-legacy-secrets.ts` — see docs/SECURITY.md.',
      )
    }
    warnLegacyPlaintextOnce()
    return value // legacy plaintext
  }
  try {
    const body = value.slice(PREFIX.length)
    const [ivB64, tagB64, ctB64] = body.split(':')
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed ciphertext')
    const key = getKey()
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'), {
      authTagLength: 16,
    })
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
    return pt.toString('utf-8')
  } catch (err) {
    console.error('[encryption] decrypt failed:', err)
    throw err
  }
}

/** Decrypt a User.twoFactorSecret; optionally hard-fails on legacy plaintext in production. */
export function decryptTwoFactorSecret(value: string): string {
  return decrypt(value, { rejectLegacyPlaintext: rejectLegacyPlaintext2FAEnabled() })
}

export type SafeDecryptFailure = 'key_missing' | 'decrypt_failed'

export type SafeDecryptResult =
  | { ok: true; value: string }
  | { ok: false; reason: SafeDecryptFailure }

/**
 * Non-throwing decrypt for operational paths (email workers, test send).
 * `decrypt()` is still correct for auth flows (2FA) where a bad key
 * should hard-fail. Email paths need a clear operator-facing error
 * instead of a 500 that looks like a transient server fault — most
 * commonly after an ENCRYPTION_KEY rotation orphans existing ciphertext.
 */
export function safeDecrypt(value: string): SafeDecryptResult {
  if (value == null || value === '') return { ok: true, value: '' }
  if (!value.startsWith(PREFIX)) {
    warnLegacyPlaintextOnce()
    return { ok: true, value }
  }
  try {
    return { ok: true, value: decrypt(value) }
  } catch (err: any) {
    const msg = String(err?.message || '')
    if (msg.includes('ENCRYPTION_KEY')) {
      return { ok: false, reason: 'key_missing' }
    }
    return { ok: false, reason: 'decrypt_failed' }
  }
}

/** Operator-facing copy for `safeDecrypt` failures. */
export function decryptFailureMessage(reason: SafeDecryptFailure): string {
  if (reason === 'key_missing') {
    return 'Stored email password could not be decrypted: ENCRYPTION_KEY is not configured.'
  }
  return (
    'Stored email password could not be decrypted — the encryption key may have changed. ' +
    'Re-save your email settings with the current password.'
  )
}
