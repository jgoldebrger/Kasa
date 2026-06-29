import crypto from 'crypto'

/** Recent TOTP verification for sensitive platform-admin actions (~5 min). */
export const PLATFORM_ADMIN_TOTP_MAX_AGE_SEC = 5 * 60

export const PLATFORM_ADMIN_TOTP_COOKIE = 'kasa_platform_admin_totp'

interface TotpPayload {
  u: string
  iat: number
  exp: number
}

function signingSecret(): string | null {
  return process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || null
}

function verifyTokenBody(token: string): TotpPayload | null {
  const secret = signingSecret()
  if (!secret) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  if (sig.length !== expected.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TotpPayload
  } catch {
    return null
  }
}

export function createPlatformAdminTotpToken(userId: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const now = Math.floor(Date.now() / 1000)
  const payload: TotpPayload = { u: userId, iat: now, exp: now + PLATFORM_ADMIN_TOTP_MAX_AGE_SEC }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function readPlatformAdminTotpVerifiedAt(token: string, userId: string): number | null {
  const payload = verifyTokenBody(token)
  if (!payload) return null
  if (payload.u !== userId) return null
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) return null
  return typeof payload.iat === 'number' && payload.iat > 0 ? payload.iat : null
}

export function isPlatformAdminTotpTokenValid(token: string, userId: string): boolean {
  return readPlatformAdminTotpVerifiedAt(token, userId) !== null
}
