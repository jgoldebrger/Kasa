export const ADMIN_ONLY_FAMILY_TABS = new Set([
  'payments',
  'withdrawals',
  'events',
  'cycle-charges',
  'statements',
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

export const FAMILY_TABS: { id: FamilyTabId; label: string; adminOnly?: boolean }[] = [
  { id: 'info', label: 'Info' },
  { id: 'members', label: 'Members' },
  { id: 'payments', label: 'Payments', adminOnly: true },
  { id: 'withdrawals', label: 'Withdrawals', adminOnly: true },
  { id: 'events', label: 'Lifecycle Events', adminOnly: true },
  { id: 'cycle-charges', label: 'Cycle Charges', adminOnly: true },
  { id: 'statements', label: 'Statements', adminOnly: true },
  { id: 'tasks', label: 'Tasks', adminOnly: true },
  { id: 'sub-families', label: 'Sub-Families' },
]
