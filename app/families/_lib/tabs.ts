import type { MessageKey } from '@/lib/i18n/load-locale'
import type { FamilyTabDef, FamilyTabGroup, FamilyTabId } from './types'

export const FAMILY_TAB_GROUPS: readonly { id: FamilyTabGroup; labelKey: MessageKey }[] = [
  { id: 'profile', labelKey: 'family.tabGroup.profile' },
  { id: 'money', labelKey: 'family.tabGroup.money' },
  { id: 'activity', labelKey: 'family.tabGroup.activity' },
] as const

/** Profile → Money → Activity; URL segments unchanged from legacy constants. */
export const FAMILY_TABS: readonly FamilyTabDef[] = [
  {
    id: 'info',
    segment: '',
    labelKey: 'family.tab.info',
    fallbackLabel: 'Info',
    group: 'profile',
  },
  {
    id: 'members',
    segment: 'members',
    labelKey: 'family.members',
    fallbackLabel: 'Members',
    group: 'profile',
  },
  {
    id: 'sub-families',
    segment: 'sub-families',
    labelKey: 'family.subFamilies',
    fallbackLabel: 'Sub-Families',
    group: 'profile',
  },
  {
    id: 'payments',
    segment: 'payments',
    labelKey: 'family.payments',
    fallbackLabel: 'Payments',
    group: 'money',
    adminOnly: true,
  },
  {
    id: 'withdrawals',
    segment: 'withdrawals',
    labelKey: 'family.withdrawals',
    fallbackLabel: 'Withdrawals',
    group: 'money',
    adminOnly: true,
  },
  {
    id: 'cycle-charges',
    segment: 'cycle-charges',
    labelKey: 'family.cycleCharges',
    fallbackLabel: 'Cycle Charges',
    group: 'money',
    adminOnly: true,
  },
  {
    id: 'statements',
    segment: 'statements',
    labelKey: 'family.statements',
    fallbackLabel: 'Statements',
    group: 'money',
    memberReadable: true,
  },
  {
    id: 'events',
    segment: 'events',
    labelKey: 'family.lifecycleEvents',
    fallbackLabel: 'Lifecycle Events',
    group: 'activity',
    adminOnly: true,
  },
  {
    id: 'tasks',
    segment: 'tasks',
    labelKey: 'nav.tasks',
    fallbackLabel: 'Tasks',
    group: 'activity',
    adminOnly: true,
  },
  {
    id: 'emails',
    segment: 'emails',
    labelKey: 'family.emails',
    fallbackLabel: 'Emails',
    group: 'activity',
    adminOnly: true,
  },
] as const

export function familyTabHref(familyId: string, tabId: FamilyTabId): string {
  const tab = FAMILY_TABS.find((t) => t.id === tabId)
  const segment = tab?.segment ?? ''
  return segment ? `/families/${familyId}/${segment}` : `/families/${familyId}`
}

export function familyTabFromPathname(pathname: string, familyId: string): FamilyTabId {
  const prefix = `/families/${familyId}`
  if (!pathname.startsWith(prefix)) return 'info'
  const rest = pathname.slice(prefix.length).replace(/^\//, '')
  if (!rest) return 'info'
  const segment = rest.split('/')[0]
  const match = FAMILY_TABS.find((tab) => tab.segment === segment)
  return match?.id ?? 'info'
}

export function resolveFamilyTabLabel(
  tab: FamilyTabDef,
  t: (key: MessageKey, fallback?: string) => string,
): string {
  return t(tab.labelKey, tab.fallbackLabel)
}

export type { FamilyTabDef, FamilyTabGroup, FamilyTabId } from './types'
