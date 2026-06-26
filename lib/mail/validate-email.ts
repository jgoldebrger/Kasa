/** Lightweight format check for family contact emails (not deliverability). */
export function isValidEmailFormat(email: string | null | undefined): boolean {
  const trimmed = (email ?? '').trim()
  if (!trimmed) return true
  if (trimmed.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/** True when a non-empty email fails `isValidEmailFormat`. */
export function emailFormatInvalidFlag(email: string | null | undefined): boolean {
  const trimmed = (email ?? '').trim()
  if (!trimmed) return false
  return !isValidEmailFormat(trimmed)
}
