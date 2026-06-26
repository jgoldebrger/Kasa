/**
 * Canonical merge-field tokens for communications emails.
 * Safe to import from client components (no server dependencies).
 */

export type MergeFieldCategory = 'family' | 'billing' | 'dates' | 'organization'

export type MergeFieldKey =
  | 'familyName'
  | 'hebrewName'
  | 'email'
  | 'phone'
  | 'husbandCellPhone'
  | 'wifeCellPhone'
  | 'street'
  | 'city'
  | 'state'
  | 'zip'
  | 'fullAddress'
  | 'balance'
  | 'dues'
  | 'planName'
  | 'eventDate'
  | 'nextDue'
  | 'orgName'

export interface MergeFieldDefinition {
  key: MergeFieldKey
  /** i18n key under communications.mergeField.* */
  labelKey: string
  category: MergeFieldCategory
  /** Sample value for email preview */
  sample: string
}

export const MERGE_FIELD_DEFINITIONS: readonly MergeFieldDefinition[] = [
  {
    key: 'familyName',
    labelKey: 'communications.mergeField.familyName',
    category: 'family',
    sample: 'Cohen Family',
  },
  {
    key: 'hebrewName',
    labelKey: 'communications.mergeField.hebrewName',
    category: 'family',
    sample: 'משפחת כהן',
  },
  {
    key: 'email',
    labelKey: 'communications.mergeField.email',
    category: 'family',
    sample: 'family@example.com',
  },
  {
    key: 'phone',
    labelKey: 'communications.mergeField.phone',
    category: 'family',
    sample: '(555) 123-4567',
  },
  {
    key: 'husbandCellPhone',
    labelKey: 'communications.mergeField.husbandCellPhone',
    category: 'family',
    sample: '(555) 111-2222',
  },
  {
    key: 'wifeCellPhone',
    labelKey: 'communications.mergeField.wifeCellPhone',
    category: 'family',
    sample: '(555) 333-4444',
  },
  {
    key: 'street',
    labelKey: 'communications.mergeField.street',
    category: 'family',
    sample: '123 Main St',
  },
  {
    key: 'city',
    labelKey: 'communications.mergeField.city',
    category: 'family',
    sample: 'Brooklyn',
  },
  { key: 'state', labelKey: 'communications.mergeField.state', category: 'family', sample: 'NY' },
  { key: 'zip', labelKey: 'communications.mergeField.zip', category: 'family', sample: '11201' },
  {
    key: 'fullAddress',
    labelKey: 'communications.mergeField.fullAddress',
    category: 'family',
    sample: '123 Main St, Brooklyn, NY 11201',
  },
  {
    key: 'balance',
    labelKey: 'communications.mergeField.balance',
    category: 'billing',
    sample: '$125.00',
  },
  {
    key: 'dues',
    labelKey: 'communications.mergeField.dues',
    category: 'billing',
    sample: '$500.00',
  },
  {
    key: 'planName',
    labelKey: 'communications.mergeField.planName',
    category: 'billing',
    sample: 'Annual membership',
  },
  {
    key: 'eventDate',
    labelKey: 'communications.mergeField.eventDate',
    category: 'dates',
    sample: 'June 15, 2026',
  },
  {
    key: 'nextDue',
    labelKey: 'communications.mergeField.nextDue',
    category: 'dates',
    sample: 'September 1, 2026',
  },
  {
    key: 'orgName',
    labelKey: 'communications.mergeField.orgName',
    category: 'organization',
    sample: 'Your Organization',
  },
] as const

export const MERGE_FIELD_KEYS = MERGE_FIELD_DEFINITIONS.map((d) => d.key)

export function mergeFieldToken(key: MergeFieldKey): string {
  return `{{${key}}}`
}

export function mergeFieldSamples(): Record<string, string> {
  return Object.fromEntries(MERGE_FIELD_DEFINITIONS.map((d) => [d.key, d.sample]))
}

export const MERGE_FIELD_CATEGORY_ORDER: MergeFieldCategory[] = [
  'family',
  'billing',
  'dates',
  'organization',
]
