import type { MessageKey } from '@/lib/i18n/load-locale'
import {
  FAMILY_TABS as REGISTRY_TABS,
  familyTabFromPathname,
  familyTabHref,
  type FamilyTabDef as RegistryFamilyTabDef,
  type FamilyTabId,
} from '../../_lib'

export type { FamilyTabId } from '../../_lib'

/** @deprecated Prefer filterVisibleFamilyTabs from app/families/_lib */
export const ADMIN_ONLY_FAMILY_TABS = new Set(
  REGISTRY_TABS.filter((tab) => tab.adminOnly).map((tab) => tab.id),
)

export const FAMILY_TAB_SEGMENTS: Record<FamilyTabId, string> = Object.fromEntries(
  REGISTRY_TABS.map((tab) => [tab.id, tab.segment]),
) as Record<FamilyTabId, string>

export { familyTabFromPathname, familyTabHref }

/** Legacy tab shape for existing call sites during hub migration. */
export type FamilyTabDef = {
  id: FamilyTabId
  label: string
  i18nKey?: string
  adminOnly?: boolean
  memberReadable?: boolean
}

function toLegacyTabDef(tab: RegistryFamilyTabDef): FamilyTabDef {
  return {
    id: tab.id,
    label: tab.fallbackLabel,
    i18nKey: tab.labelKey,
    adminOnly: tab.adminOnly,
    memberReadable: tab.memberReadable,
  }
}

export const FAMILY_TABS: FamilyTabDef[] = REGISTRY_TABS.map(toLegacyTabDef)

export function resolveFamilyTabLabel(
  tab: FamilyTabDef,
  t: (key: MessageKey, fallback?: string) => string,
): string {
  return tab.i18nKey ? t(tab.i18nKey as MessageKey, tab.label) : tab.label
}
