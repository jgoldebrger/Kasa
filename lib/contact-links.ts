import { normalizePhoneDigits } from '@/lib/phone-format'

export function phoneTelHref(value: string): string {
  const digits = normalizePhoneDigits(value)
  if (!digits) return ''
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:+${digits}`
}

export function mailtoHref(value: string): string {
  const email = value.trim()
  return email ? `mailto:${email}` : ''
}
