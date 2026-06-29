import crypto from 'crypto'
import { OrgApiKey } from '@/lib/models'
import type { OrgPermission } from '@/types/auth'

const KEY_PREFIX = 'kasa_'

/**
 * Org API keys are stored as SHA-256(token). The plaintext is shown once on
 * create — same pattern as invite tokens (lib/invite-token.ts).
 */
export function hashOrgApiKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateOrgApiKey(): { token: string; prefix: string } {
  const secret = crypto.randomBytes(24).toString('base64url')
  const token = `${KEY_PREFIX}${secret}`
  return { token, prefix: token.slice(0, 12) }
}

export function parseBearerOrgApiKey(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token.startsWith(KEY_PREFIX) || token.length < 20) return null
  return token
}

export async function findOrgApiKeyByToken(token: string) {
  const hashed = hashOrgApiKey(token)
  return OrgApiKey.findOne({ keyHash: hashed, revokedAt: null }).lean<{
    _id: { toString(): string }
    organizationId: { toString(): string }
    scopes: OrgPermission[]
    name: string
    prefix: string
  }>()
}
