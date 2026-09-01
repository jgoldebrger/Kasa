import type { Role } from '@/types/auth'

/**
 * Who may assign which org roles.
 *
 * Owner is restricted: only an existing owner can promote/invite to owner.
 * Admins may assign admin and below (including specialist presets).
 */
export function canAssignOrgRole(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === 'owner') return actorRole === 'owner'
  if (actorRole === 'owner' || actorRole === 'admin') return true
  return false
}

/** Non-owners must not mutate another owner's membership. */
export function canMutateMemberRole(actorRole: Role, memberRole: Role): boolean {
  if (memberRole === 'owner' && actorRole !== 'owner') return false
  return actorRole === 'owner' || actorRole === 'admin'
}
