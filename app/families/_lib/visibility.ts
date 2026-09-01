import type { FamilyTabDef } from './types'

export function filterVisibleFamilyTabs(
  tabs: readonly FamilyTabDef[],
  ctx: { isAdmin: boolean; memberFinancialAccess: boolean },
): FamilyTabDef[] {
  return tabs.filter((tab) => {
    if (tab.adminOnly) return ctx.isAdmin
    if (tab.memberReadable) return ctx.isAdmin || ctx.memberFinancialAccess
    return true
  })
}
