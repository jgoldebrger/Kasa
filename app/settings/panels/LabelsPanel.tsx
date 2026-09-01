'use client'

import type { Dispatch, SetStateAction } from 'react'
import MailLabelsPanel from '@/app/components/settings/MailLabelsPanel'
import type { FamilyShape, MailLabelFilters } from '@/lib/client/mail-label-audience'

interface PlanShape {
  _id: string
  name: string
}

export interface LabelsPanelProps {
  families: FamilyShape[]
  plans: PlanShape[]
  filters: MailLabelFilters
  setFilters: Dispatch<SetStateAction<MailLabelFilters>>
}

export default function LabelsPanel({ families, plans, filters, setFilters }: LabelsPanelProps) {
  return (
    <MailLabelsPanel families={families} plans={plans} filters={filters} setFilters={setFilters} />
  )
}
