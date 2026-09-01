'use client'

import { useT } from '@/lib/client/i18n'
import { useFamilyDetail } from './FamilyDetailContext'
import { FamilyClusteredTabNav } from '../_lib/FamilyClusteredTabNav'

export default function FamilyTabNav() {
  const { familyId, activeTab, isAdmin, memberFinancialAccess } = useFamilyDetail()
  const t = useT()

  return (
    <FamilyClusteredTabNav
      familyId={familyId}
      activeTab={activeTab}
      isAdmin={isAdmin}
      memberFinancialAccess={memberFinancialAccess}
      t={t}
    />
  )
}
