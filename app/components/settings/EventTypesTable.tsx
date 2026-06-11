'use client'

/**
 * Shared lifecycle-event-types table — used both by /lifecycle-event-types
 * and the Event Types tab of /settings. Built on <DataView> so column-picker
 * and CSV/XLSX export work out of the box.
 */

import { PencilIcon, TrashIcon, CalendarIcon } from '@heroicons/react/24/outline'
import { useCurrency } from '@/lib/client/useCurrency'
import {
  DataView,
  EmptyState,
  type DataColumn,
} from '@/app/components/ui'

export interface EventTypeRow {
  _id: string
  type: string
  name: string
  amount: number
}

interface Props {
  eventTypes: EventTypeRow[]
  onEdit: (eventType: EventTypeRow) => void
  onDelete: (id: string) => void
  tableId?: string
  /** Optional empty-state CTA shown when the org has no event types configured. */
  emptyCta?: { label: string; onClick: () => void }
}

export default function EventTypesTable({
  eventTypes,
  onEdit,
  onDelete,
  tableId = 'event-types',
  emptyCta,
}: Props) {
  const { format: formatMoney } = useCurrency()
  const columns: DataColumn<EventTypeRow>[] = [
    {
      id: 'name',
      header: 'Name',
      headerText: 'Name',
      cell: (e) => (
        <button
          onClick={() => onEdit(e)}
          className="focus-ring font-semibold text-accent hover:text-accent-hover hover:underline text-left rounded"
        >
          {e.name}
        </button>
      ),
      exportValue: (e) => e.name,
      filter: { type: 'text' },
    },
    {
      id: 'type',
      header: 'Type Code',
      headerText: 'Type Code',
      hideBelow: 'md',
      defaultHidden: true,
      cell: (e) => <span className="text-xs text-fg-muted tabular">{e.type}</span>,
      exportValue: (e) => e.type || '',
    },
    {
      id: 'amount',
      header: 'Amount',
      headerText: 'Amount',
      align: 'right',
      cell: (e) => (
        <span className="font-bold tabular text-green-700 dark:text-green-400">
          {formatMoney(e.amount)}
        </span>
      ),
      exportValue: (e) => e.amount || 0,
      filter: { type: 'numberRange', getValue: (e) => e.amount || 0 },
    },
    {
      id: 'actions',
      header: 'Actions',
      headerText: 'Actions',
      align: 'right',
      cell: (e) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(e)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
            title="Edit event type"
            aria-label={`Edit ${e.name}`}
          >
            <PencilIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(e._id)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            title="Delete event type"
            aria-label={`Delete ${e.name}`}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ),
      exportValue: () => '',
    },
  ]

  return (
    <DataView
      tableId={tableId}
      rows={eventTypes}
      columns={columns}
      rowKey={(e) => e._id}
      globalSearch={{ placeholder: 'Search event types…' }}
      pageSize={10}
      mobileCard={(e) => (
        <div className="surface-card p-4">
          <div className="flex items-start justify-between gap-3">
            <button
              onClick={() => onEdit(e)}
              className="focus-ring font-semibold text-accent hover:underline text-left rounded"
            >
              {e.name}
            </button>
            <div className="font-bold tabular text-green-700 dark:text-green-400">
              {formatMoney(e.amount)}
            </div>
          </div>
          <div className="mt-1 text-xs text-fg-muted tabular">{e.type}</div>
          <div className="mt-3 flex justify-end gap-1">
            <button
              onClick={() => onEdit(e)}
              aria-label={`Edit ${e.name}`}
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => onDelete(e._id)}
              aria-label={`Delete ${e.name}`}
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      empty={
        <EmptyState
          icon={<CalendarIcon className="h-10 w-10" />}
          title="No event types"
          description="Create lifecycle event types (Bar Mitzvah, Chasena, etc.) for tracking."
          cta={emptyCta}
        />
      }
    />
  )
}
