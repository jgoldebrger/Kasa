/**
 * Expands a list of families into individual mail-label rows.
 *
 * Mail labels used to be strictly one-per-household. Staff needed targeted
 * physical mailings (ladies only, bucherim only, kids from a given age), which
 * is a person-level audience — something no other surface in the app does.
 *
 * All logic here is pure so it can be unit-tested without React or the network.
 * `today` is injected rather than read from the clock so age math is stable.
 */

export interface FamilyShape {
  _id: string
  name: string
  street?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  paymentPlanId?: string | null
  husbandFirstName?: string
  wifeFirstName?: string
}

export interface MemberShape {
  _id?: string
  firstName?: string
  lastName?: string
  birthDate?: string | Date | null
  gender?: string
  weddingDate?: string | Date | null
}

export interface LabelRow {
  name: string
  street: string
  cityState: string
}

export type MaritalFilter = 'any' | 'unmarried' | 'married'

export interface RecipientToggles {
  household: boolean
  husband: boolean
  wife: boolean
  sons: boolean
  daughters: boolean
}

export interface AudienceFilters {
  recipients: RecipientToggles
  marital: MaritalFilter
  minAge: number | null
  maxAge: number | null
}

export interface MailLabelFilters extends AudienceFilters {
  planIds: string[]
  balance: 'all' | 'negative'
  requireAddress: boolean
  search: string
}

export const DEFAULT_MAIL_LABEL_FILTERS: MailLabelFilters = {
  planIds: [],
  balance: 'all',
  requireAddress: true,
  search: '',
  recipients: {
    household: true,
    husband: false,
    wife: false,
    sons: false,
    daughters: false,
  },
  marital: 'any',
  minAge: null,
  maxAge: null,
}

/** Street + "City, ST Zip" for one family. Shared by every row in that family. */
export function formatFamilyAddress(family: FamilyShape): { street: string; cityState: string } {
  const cityState = [family.city, family.state].filter(Boolean).join(', ')
  const cityStateZip = [cityState, family.zip?.trim()].filter(Boolean).join(' ')
  return {
    street: (family.street || family.address || '').trim(),
    cityState: cityStateZip,
  }
}

/** Whole years as of `today`, or null when there is no usable birth date. */
export function computeAge(
  birthDate: string | Date | null | undefined,
  today: Date,
): number | null {
  if (!birthDate) return null
  const born = birthDate instanceof Date ? birthDate : new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null
  let age = today.getFullYear() - born.getFullYear()
  const monthDelta = today.getMonth() - born.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getDate())) {
    age -= 1
  }
  return age
}

/** Maps a number input's raw string to an age bound. Blank / invalid means "no bound". */
export function parseAgeInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/**
 * Husband/wife labels read "{firstName} {Family.name}". Some orgs already store
 * a given name inside `Family.name`, which would print "Yossi Goldberg, Yossi" —
 * so skip the prefix when the family name already leads with it.
 */
function joinPersonAndFamilyName(firstName: string, familyName: string): string {
  const first = firstName.trim()
  const family = familyName.trim()
  if (!first) return family
  if (!family) return first
  if (family.toLowerCase().startsWith(first.toLowerCase())) return family
  return `${first} ${family}`
}

function memberLabelName(member: MemberShape, familyName: string): string {
  const first = (member.firstName || '').trim()
  if (!first) return ''
  const last = (member.lastName || '').trim()
  if (last) return `${first} ${last}`
  return joinPersonAndFamilyName(first, familyName)
}

export function resolveAudience(
  families: FamilyShape[],
  membersByFamily: Record<string, MemberShape[]>,
  filters: AudienceFilters,
  today: Date,
): { rows: LabelRow[]; skippedNoBirthDate: number } {
  const { recipients, marital, minAge, maxAge } = filters
  const hasAgeBound = minAge !== null || maxAge !== null
  const wantsMembers = recipients.sons || recipients.daughters

  const rows: LabelRow[] = []
  const skippedIds = new Set<string>()
  let skippedWithoutId = 0

  for (const family of families) {
    const address = formatFamilyAddress(family)
    const familyName = family.name || ''
    const push = (name: string) => {
      if (name) rows.push({ name, ...address })
    }

    if (recipients.household) push(familyName.trim())
    if (recipients.husband) {
      const husbandFirst = (family.husbandFirstName || '').trim()
      if (husbandFirst) push(joinPersonAndFamilyName(husbandFirst, familyName))
    }
    if (recipients.wife) {
      const wifeFirst = (family.wifeFirstName || '').trim()
      if (wifeFirst) push(joinPersonAndFamilyName(wifeFirst, familyName))
    }

    if (!wantsMembers) continue

    for (const member of membersByFamily[family._id] || []) {
      const gender = (member.gender || '').toLowerCase()
      const isSon = gender === 'male'
      const isDaughter = gender === 'female'
      if (!isSon && !isDaughter) continue
      if (isSon && !recipients.sons) continue
      if (isDaughter && !recipients.daughters) continue

      if (marital === 'unmarried' && member.weddingDate) continue
      if (marital === 'married' && !member.weddingDate) continue

      if (hasAgeBound) {
        const age = computeAge(member.birthDate, today)
        if (age === null) {
          if (member._id) skippedIds.add(member._id)
          else skippedWithoutId += 1
          continue
        }
        if (minAge !== null && age < minAge) continue
        if (maxAge !== null && age > maxAge) continue
      }

      push(memberLabelName(member, familyName))
    }
  }

  return { rows, skippedNoBirthDate: skippedIds.size + skippedWithoutId }
}
