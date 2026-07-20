'use client'

import { TabNav } from '@/app/components/ui'
import { useFamilyDetail } from './FamilyDetailContext'
import { FAMILY_TABS, familyTabHref, resolveFamilyTabLabel } from './_lib/constants'
import { useT } from '@/lib/client/i18n'

export default function FamilyTabNav() {
  const { familyId, activeTab, isAdmin, memberFinancialAccess } = useFamilyDetail()
  const t = useT()

  const visibleTabs = FAMILY_TABS.filter((tab) => {
    if (tab.adminOnly) return isAdmin
    if (tab.memberReadable) return isAdmin || memberFinancialAccess
    return true
  })

  return (
    <TabNav
      label="Family sections"
      activeId={activeTab}
      items={visibleTabs.map((tab) => ({
        id: tab.id,
        href: familyTabHref(familyId, tab.id),
        label: resolveFamilyTabLabel(tab, t),
      }))}
    />
  )
}
