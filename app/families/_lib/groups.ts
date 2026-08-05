import type { FamilyTabDef, FamilyTabGroup } from './types'

export function groupVisibleFamilyTabs(tabs: FamilyTabDef[]) {
  const order: FamilyTabGroup[] = ['profile', 'money', 'activity']
  return order
    .map((group) => ({ group, tabs: tabs.filter((t) => t.group === group) }))
    .filter((g) => g.tabs.length > 0)
}
