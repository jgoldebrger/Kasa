import crypto from 'crypto'

const MAX_AGE_SEC = 8 * 60 * 60

interface ImpersonationPayload {
  u: string
  o: string
  iat: number
  exp: number
  ro?: boolean
}

export type ImpersonationDetails = {
  orgId: string
  readOnly: boolean
  expiresAt: number
  /** Unix seconds when the support session started. */
  startedAt: number
}

function signingSecret(): string | null {
  return process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || null
}

function verifyTokenBody(token: string): ImpersonationPayload | null {
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
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ImpersonationPayload
  } catch {
    return null
  }
}

export function createImpersonationToken(
  userId: string,
  orgId: string,
  readOnly?: boolean,
): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const now = Math.floor(Date.now() / 1000)
  const payload: ImpersonationPayload = {
    u: userId,
    o: orgId,
    iat: now,
    exp: now + MAX_AGE_SEC,
  }
  if (readOnly) payload.ro = true
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function readImpersonationDetails(
  token: string,
  userId: string,
): ImpersonationDetails | null {
  const payload = verifyTokenBody(token)
  if (!payload) return null
  if (payload.u !== userId) return null
  if (!payload.o || payload.exp < Math.floor(Date.now() / 1000)) return null
  const startedAt =
    typeof payload.iat === 'number' && payload.iat > 0 ? payload.iat : payload.exp - MAX_AGE_SEC
  return {
    orgId: payload.o,
    readOnly: payload.ro === true,
    expiresAt: payload.exp,
    startedAt,
  }
}

export function verifyImpersonationToken(token: string, userId: string): string | null {
  return readImpersonationDetails(token, userId)?.orgId ?? null
}

export const IMPERSONATION_MAX_AGE_SEC = MAX_AGE_SEC
