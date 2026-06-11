'use client'

/**
 * Shared payment-plans table — used both by /payment-plans (top-level page)
 * and the Payment Plans tab of /settings. Builds on the shared <DataView> so
 * column-picker + CSV/XLSX export work consistently.
 *
 * The pre-existing "expandable row" UX (clicking the family count revealed an
 * inline family list) is preserved by rendering the expanded panel BELOW the
 * table, anchored to the currently-selected plan.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useCurrency } from '@/lib/client/useCurrency'
import {
  PencilIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  UserGroupIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline'
import {
  DataView,
  EmptyState,
  type DataColumn,
} from '@/app/components/ui'

export interface PaymentPlanFamily {
  _id: string
  name: string
  weddingDate: string
}

export interface PaymentPlanRow {
  _id: string
  name: string
  yearlyPrice: number
  familyCount?: number
  families?: PaymentPlanFamily[]
}

interface Props {
  plans: PaymentPlanRow[]
  onEdit: (plan: PaymentPlanRow) => void
  onDelete: (id: string) => void
  /** Optional override for the table id (default `payment-plans`). */
  tableId?: string
}

export default function PaymentPlansTable({
  plans,
  onEdit,
  onDelete,
  tableId = 'payment-plans',
}: Props) {
  const { format: formatMoney } = useCurrency()
  const [expanded, setExpanded] = useState<string | null>(null)

  const columns: DataColumn<PaymentPlanRow>[] = [
    {
      id: 'name',
      header: 'Plan Name',
      headerText: 'Plan Name',
      cell: (p) => (
        <button
          onClick={() => onEdit(p)}
          className="focus-ring font-medium text-accent hover:text-accent-hover hover:underline text-left rounded"
        >
          {p.name}
        </button>
      ),
      exportValue: (p) => p.name,
      filter: { type: 'text' },
    },
    {
      id: 'yearly',
      header: 'Yearly Price',
      headerText: 'Yearly Price',
      align: 'right',
      cell: (p) => <span className="font-semibold tabular text-fg">{formatMoney(p.yearlyPrice)}</span>,
      exportValue: (p) => p.yearlyPrice || 0,
      filter: { type: 'numberRange', getValue: (p) => p.yearlyPrice || 0 },
    },
    {
      id: 'monthly',
      header: 'Monthly Price',
      headerText: 'Monthly Price',
      align: 'right',
      hideBelow: 'md',
      cell: (p) => <span className="tabular text-fg-muted">{formatMoney(p.yearlyPrice / 12)}</span>,
      exportValue: (p) => Number((p.yearlyPrice / 12).toFixed(2)),
    },
    {
      id: 'families',
      header: 'Families',
      headerText: 'Family Count',
      cell: (p) => {
        const open = expanded === p._id
        return (
          <button
            onClick={() => setExpanded(open ? null : p._id)}
            className="focus-ring inline-flex items-center gap-1.5 rounded text-accent hover:text-accent-hover"
          >
            <UserGroupIcon className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium">{p.familyCount || 0}</span>
            {open ? (
              <ChevronUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )
      },
      exportValue: (p) => p.familyCount || 0,
    },
    {
      id: 'actions',
      header: 'Actions',
      headerText: 'Actions',
      align: 'right',
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(p)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
            title="Edit plan"
            aria-label={`Edit ${p.name}`}
          >
            <PencilIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(p._id)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            title="Delete plan"
            aria-label={`Delete ${p.name}`}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ),
      exportValue: () => '',
    },
  ]

  const expandedPlan = expanded ? plans.find((p) => p._id === expanded) : null

  return (
    <div className="space-y-3">
      <DataView
        tableId={tableId}
        rows={plans}
        columns={columns}
        rowKey={(p) => p._id}
        globalSearch={{ placeholder: 'Search plans…' }}
        pageSize={10}
        mobileCard={(p) => {
          const open = expanded === p._id
          return (
            <div className="surface-card p-4">
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => onEdit(p)}
                  className="focus-ring font-semibold text-accent hover:underline text-left rounded"
                >
                  {p.name}
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit(p)}
                    aria-label={`Edit ${p.name}`}
                    className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDelete(p._id)}
                    aria-label={`Delete ${p.name}`}
                    className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
                <div>
                  <dt className="text-fg-muted">Yearly</dt>
                  <dd className="tabular font-semibold">{formatMoney(p.yearlyPrice)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Monthly</dt>
                  <dd className="tabular">{formatMoney(p.yearlyPrice / 12)}</dd>
                </div>
              </dl>
              <button
                onClick={() => setExpanded(open ? null : p._id)}
                className="focus-ring mt-3 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
              >
                <UserGroupIcon className="h-4 w-4" aria-hidden="true" />
                {p.familyCount || 0} families
                {open ? (
                  <ChevronUpIcon className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
                )}
              </button>
            </div>
          )
        }}
        empty={
          <EmptyState
            icon={<CreditCardIcon className="h-10 w-10" />}
            title="No payment plans"
            description="Create your first payment plan to start charging members."
          />
        }
      />

      {expandedPlan && (
        <div className="surface-card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-fg">
              Families using <span className="text-accent">{expandedPlan.name}</span>
            </h4>
            <button
              onClick={() => setExpanded(null)}
              className="focus-ring text-xs text-fg-muted hover:text-fg rounded"
            >
              Close
            </button>
          </div>
          {expandedPlan.families && expandedPlan.families.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {expandedPlan.families.map((f) => (
                <Link
                  key={f._id}
                  href={`/families/${f._id}`}
                  className="focus-ring block rounded-md border border-border bg-app-subtle p-3 hover:bg-fg/5"
                >
                  <div className="font-medium text-fg">{f.name}</div>
                  <div className="text-xs text-fg-muted mt-1 tabular">
                    Wedding: {new Date(f.weddingDate).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">No families are currently using this plan.</p>
          )}
        </div>
      )}
    </div>
  )
}
