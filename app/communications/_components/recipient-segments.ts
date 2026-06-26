import type { FamilyOption } from './types'

export type RecipientSegment =
  | 'all'
  | 'has-email'
  | 'opted-out'
  | 'deliverability-warning'
  | 'invalid-format'
  | 'balance-gt-zero'

export const RECIPIENT_SEGMENTS: RecipientSegment[] = [
  'all',
  'has-email',
  'opted-out',
  'deliverability-warning',
  'invalid-format',
  'balance-gt-zero',
]

export function isSelectableFamily(f: FamilyOption): boolean {
  return Boolean(f.email?.trim()) && !f.communicationsOptOut
}

export function filterFamiliesBySegment(
  families: FamilyOption[],
  segment: RecipientSegment,
): FamilyOption[] {
  switch (segment) {
    case 'all':
      return families
    case 'has-email':
      return families.filter((f) => Boolean(f.email?.trim()))
    case 'opted-out':
      return families.filter((f) => Boolean(f.communicationsOptOut))
    case 'deliverability-warning':
      return families.filter(
        (f) =>
          Boolean(f.email?.trim()) &&
          Boolean(f.emailDeliverabilityWarning) &&
          !f.communicationsOptOut,
      )
    case 'invalid-format':
      return families.filter((f) => Boolean(f.email?.trim()) && Boolean(f.emailFormatInvalid))
    case 'balance-gt-zero':
      return families.filter((f) => (f.openBalance ?? 0) > 0)
    default:
      return families
  }
}

export function segmentCount(families: FamilyOption[], segment: RecipientSegment): number {
  return filterFamiliesBySegment(families, segment).length
}
