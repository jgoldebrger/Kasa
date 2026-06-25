/** Email-link rules for member read-only financial access (no server deps). */

export function normalizeMemberEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * True when the signed-in user's email matches the family record or any
 * member's email on that family (case-insensitive).
 */
export function userEmailMatchesFamily(
  userEmail: string,
  family: { email?: string | null },
  members: Array<{ email?: string | null }>,
): boolean {
  const norm = normalizeMemberEmail(userEmail)
  if (!norm) return false
  if (family.email && normalizeMemberEmail(family.email) === norm) return true
  return members.some((m) => m.email && normalizeMemberEmail(m.email) === norm)
}
