'use client'

import { CalendarIcon, PlusIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Button } from '@/app/components/ui'
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
    <SettingsPanel
      icon={<CalendarIcon />}
      title="Lifecycle Event Types"
      description="Manage event types and their default amounts"
      actions={
        <Button onClick={onAdd} leftIcon={<PlusIcon className="h-4 w-4" />}>
          Add Event Type
        </Button>
      }
    >
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
    </SettingsPanel>
  )
}
