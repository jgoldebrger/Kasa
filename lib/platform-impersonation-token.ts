import crypto from 'crypto'

const MAX_AGE_SEC = 8 * 60 * 60

interface ImpersonationPayload {
  u: string
  o: string
  exp: number
}

function signingSecret(): string | null {
  return process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || null
}

export function createImpersonationToken(userId: string, orgId: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const payload: ImpersonationPayload = {
    u: userId,
    o: orgId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyImpersonationToken(token: string, userId: string): string | null {
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
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as ImpersonationPayload
    if (payload.u !== userId) return null
    if (!payload.o || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload.o
  } catch {
    return null
  }
}

export const IMPERSONATION_MAX_AGE_SEC = MAX_AGE_SEC
