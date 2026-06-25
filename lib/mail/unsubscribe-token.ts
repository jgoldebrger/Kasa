import crypto from 'crypto'

function signingKey(): Buffer {
  const encKey = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET
  if (!encKey) throw new Error('ENCRYPTION_KEY is not set')
  return crypto.createHash('sha256').update(encKey).digest()
}

export function createUnsubscribeToken(organizationId: string, familyId: string): string {
  const payload = `${organizationId}:${familyId}`
  const sig = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url')
  const body = Buffer.from(payload, 'utf8').toString('base64url')
  return `${body}.${sig}`
}

export function verifyUnsubscribeToken(
  token: string,
): { organizationId: string; familyId: string } | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  let payload: string
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf))
    return null
  const [organizationId, familyId] = payload.split(':')
  if (!organizationId || !familyId) return null
  return { organizationId, familyId }
}

export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  const root = baseUrl.replace(/\/$/, '')
  return `${root}/api/email/unsubscribe?token=${encodeURIComponent(token)}`
}
