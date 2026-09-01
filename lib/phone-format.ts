/** Strip to digits only (max 15 per E.164). */
export function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 15)
}

/** Format stored/raw phone for display using US NANP when possible. */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return ''
  const digits = normalizePhoneDigits(value)
  if (!digits) return ''
  return formatPhoneInput(digits)
}

/** Format while typing or displaying US-style phone numbers. */
export function formatPhoneInput(value: string): string {
  const digits = normalizePhoneDigits(value)
  if (!digits) return ''

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`
  }

  if (digits.length <= 3) {
    return `(${digits}`
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  return `+${digits}`
}
