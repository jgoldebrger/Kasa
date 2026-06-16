'use client'

import type { Dispatch, SetStateAction } from 'react'
import MailLabelsPanel from '@/app/components/settings/MailLabelsPanel'

interface FamilyShape {
  _id: string
  name: string
  street?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  paymentPlanId?: string | null
}

interface PlanShape {
  _id: string
  name: string
}

interface LabelFilters {
  planIds: string[]
  balance: 'all' | 'negative'
  requireAddress: boolean
  search: string
}

export interface LabelsPanelProps {
  families: FamilyShape[]
  plans: PlanShape[]
  filters: LabelFilters
  setFilters: Dispatch<SetStateAction<LabelFilters>>
}

export default function LabelsPanel({
  families,
  plans,
  filters,
  setFilters,
}: LabelsPanelProps) {
  return (
    <MailLabelsPanel
      families={families}
      plans={plans}
      filters={filters}
      setFilters={setFilters}
    />
  )
}
