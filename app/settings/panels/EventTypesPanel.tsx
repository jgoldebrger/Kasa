'use client'

import { CalendarIcon, PlusIcon } from '@heroicons/react/24/outline'
import EventTypesTable from '@/app/components/settings/EventTypesTable'

export interface EventTypeRow {
  _id: string
  type: string
  name: string
  amount: number
}

export interface EventTypesPanelProps {
  eventTypes: EventTypeRow[]
  formatMoney: (amount: number) => string
  onAdd: () => void
  onEdit: (eventType: EventTypeRow) => void
  onDelete: (id: string) => void
}

export default function EventTypesPanel({
  eventTypes,
  formatMoney,
  onAdd,
  onEdit,
  onDelete,
}: EventTypesPanelProps) {
  return (
    <div className="bg-surface rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
            <CalendarIcon className="h-6 w-6 text-accent" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-fg">Lifecycle Event Types</h2>
            <p className="text-sm text-fg-muted">Manage event types and their default amounts</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onAdd}
            className="bg-accent text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-accent-hover transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            Add Event Type
          </button>
        </div>
      </div>

      <EventTypesTable
        eventTypes={eventTypes}
        onEdit={onEdit}
        onDelete={onDelete}
        tableId="settings-event-types"
        emptyCta={
          eventTypes.length === 0
            ? {
                label: 'Add event type',
                onClick: onAdd,
              }
            : undefined
        }
      />
      {eventTypes.length > 0 && (
        <div className="mt-3 flex justify-end text-sm">
          <span className="text-fg-muted">
            Total ({eventTypes.length} event types):{' '}
            <span className="font-bold text-fg tabular">
              {formatMoney(
                eventTypes.reduce((sum, e) => {
                  const n = Number(e.amount)
                  return sum + (Number.isFinite(n) ? n : 0)
                }, 0),
              )}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
