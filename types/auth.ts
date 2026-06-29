/** Organization role hierarchy used in JWT memberships and access checks. */
export type Role = 'owner' | 'admin' | 'member' | 'treasurer' | 'communications'

/** Fine-grained org permissions for preset roles and API key scopes. */
export type OrgPermission =
  | 'families:read'
  | 'payments:read'
  | 'reports:read'
  | 'communications:read'
  | 'communications:write'

/** Compact org membership carried on the JWT and session (`o` = org id, `r` = role). */
export interface SessionMembership {
  o: string
  r: Role
}
