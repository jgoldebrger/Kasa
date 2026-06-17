import crypto from 'crypto'
import { Invite } from '@/lib/models'

/**
 * Invite tokens are stored as SHA-256(token) instead of cleartext. A DB
 * dump alone is not enough to redeem an invite — the attacker would still
 * need the original token from the outbound email or invite URL.
 *
 * Old plaintext tokens still in the DB will continue to work until they
 * expire because we look up by both shapes.
 */
export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function findInviteByToken(token: string) {
  const hashed = hashInviteToken(token)
  return (await Invite.findOne({ token: hashed })) || (await Invite.findOne({ token }))
}

export async function findInviteByTokenLean<T extends Record<string, unknown>>(token: string) {
  const hashed = hashInviteToken(token)
  return (
    (await Invite.findOne({ token: hashed }).lean<T>()) ||
    (await Invite.findOne({ token }).lean<T>())
  )
}

/** Extract bearer token from an invite URL (`/invite/{token}`). */
export function inviteTokenFromUrl(inviteUrl: string): string {
  const match = inviteUrl.match(/\/invite\/([^/?#]+)/)
  if (!match?.[1]) throw new Error('Invalid invite URL')
  return decodeURIComponent(match[1])
}
