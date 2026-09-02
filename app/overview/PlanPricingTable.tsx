'use client'

import { useMemo } from 'react'
import { Card, DataView, type DataColumn } from '@/app/components/ui'
import type { PlanDefinition } from '@/lib/billing/plans'

export default function PlanPricingTable({ plans }: { plans: readonly PlanDefinition[] }) {
  const columns = useMemo<DataColumn<PlanDefinition>[]>(
    () => [
      {
        id: 'name',
        header: 'Plan',
        headerText: 'Plan',
        cell: (plan) => <span className="text-fg">{plan.name}</span>,
        exportValue: (plan) => plan.name,
      },
      {
        id: 'price',
        header: 'Monthly list price',
        headerText: 'Monthly list price',
        cell: (plan) => <span className="text-fg-muted">{plan.monthlyPriceLabel}</span>,
        exportValue: (plan) => plan.monthlyPriceLabel,
      },
      {
        id: 'cap',
        header: 'Family cap',
        headerText: 'Family cap',
        cell: (plan) => (
          <span className="text-fg-muted">
            {plan.familyCap === null ? 'Unlimited' : plan.familyCap.toLocaleString('en-US')}
          </span>
        ),
        exportValue: (plan) => (plan.familyCap === null ? 'Unlimited' : plan.familyCap),
      },
    ],
    [],
  )

  return (
    <DataView
      tableId="overview-plan-pricing"
      rows={[...plans]}
      columns={columns}
      rowKey={(plan) => plan.tier}
      toolbar={false}
      defaultSort={{ id: 'name', dir: 'asc' }}
      mobileCard={(plan) => (
        <Card compact>
          <p className="font-medium text-fg">{plan.name}</p>
          <p className="mt-1 text-sm text-fg-muted">{plan.monthlyPriceLabel}</p>
          <p className="mt-1 text-xs text-fg-muted">
            {plan.familyCap === null
              ? 'Unlimited families'
              : `${plan.familyCap.toLocaleString('en-US')} families`}
          </p>
        </Card>
      )}
    />
  )
}
