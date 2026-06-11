/** Organization role hierarchy used in JWT memberships and access checks. */
export type Role = 'owner' | 'admin' | 'member'

/** Compact org membership carried on the JWT and session (`o` = org id, `r` = role). */
export interface SessionMembership {
  o: string
  r: Role
}
