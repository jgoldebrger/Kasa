import type { MessageKey } from '@/lib/i18n/load-locale'

export const ADMIN_ONLY_FAMILY_TABS = new Set([
  'payments',
  'withdrawals',
  'events',
  'cycle-charges',
  'tasks',
])

export type FamilyTabId =
  | 'info'
  | 'members'
  | 'payments'
  | 'withdrawals'
  | 'events'
  | 'cycle-charges'
  | 'statements'
  | 'emails'
  | 'sub-families'
  | 'tasks'

export const FAMILY_TAB_SEGMENTS: Record<FamilyTabId, string> = {
  info: '',
  members: 'members',
  payments: 'payments',
  withdrawals: 'withdrawals',
  events: 'events',
  'cycle-charges': 'cycle-charges',
  statements: 'statements',
  emails: 'emails',
  'sub-families': 'sub-families',
  tasks: 'tasks',
}

export function familyTabFromPathname(pathname: string, familyId: string): FamilyTabId {
  const prefix = `/families/${familyId}`
  if (!pathname.startsWith(prefix)) return 'info'
  const rest = pathname.slice(prefix.length).replace(/^\//, '')
  if (!rest) return 'info'
  const segment = rest.split('/')[0]
  const match = Object.entries(FAMILY_TAB_SEGMENTS).find(([, seg]) => seg === segment)
  return (match?.[0] as FamilyTabId) ?? 'info'
}

export function familyTabHref(familyId: string, tab: FamilyTabId): string {
  const seg = FAMILY_TAB_SEGMENTS[tab]
  return seg ? `/families/${familyId}/${seg}` : `/families/${familyId}`
}

export type FamilyTabDef = {
  id: FamilyTabId
  /** Fallback label when i18nKey is absent or untranslated */
  label: string
  i18nKey?: string
  adminOnly?: boolean
  /** Visible to email-linked members (read-only financial tab). */
  memberReadable?: boolean
}

export const FAMILY_TABS: FamilyTabDef[] = [
  { id: 'info', label: 'Info', i18nKey: 'family.tab.info' },
  { id: 'members', label: 'Members', i18nKey: 'family.members' },
  { id: 'payments', label: 'Payments', i18nKey: 'family.payments', adminOnly: true },
  { id: 'withdrawals', label: 'Withdrawals', i18nKey: 'family.withdrawals', adminOnly: true },
  { id: 'events', label: 'Lifecycle Events', i18nKey: 'family.lifecycleEvents', adminOnly: true },
  { id: 'cycle-charges', label: 'Cycle Charges', i18nKey: 'family.cycleCharges', adminOnly: true },
  { id: 'statements', label: 'Statements', i18nKey: 'family.statements', memberReadable: true },
  { id: 'emails', label: 'Emails', i18nKey: 'family.emails', adminOnly: true },
  { id: 'tasks', label: 'Tasks', i18nKey: 'nav.tasks', adminOnly: true },
  { id: 'sub-families', label: 'Sub-Families', i18nKey: 'family.subFamilies' },
]

export function resolveFamilyTabLabel(
  tab: FamilyTabDef,
  t: (key: MessageKey, fallback?: string) => string,
): string {
  return tab.i18nKey ? t(tab.i18nKey as MessageKey, tab.label) : tab.label
}
