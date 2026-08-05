'use client'

import { useState } from 'react'
import { useFamilyDetail } from '../../FamilyDetailContext'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input, Select, Textarea } from '@/app/components/ui'

export function FamilyEventModal() {
  const {
    isAdmin,
    formatMoney,
    showEventModal,
    setShowEventModal,
    lifecycleEventTypes,
    eventForm,
    setEventForm,
    handleAddEvent,
    updateEventAmount,
  } = useFamilyDetail()

  const [submitting, setSubmitting] = useState(false)

  if (!showEventModal || !isAdmin) return null

  const handleSubmit = async (e: React.FormEvent) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await handleAddEvent(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title="Add Lifecycle Event"
      onClose={() => setShowEventModal(false)}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Event Type"
          value={eventForm.eventType}
          onChange={(e) => updateEventAmount(e.target.value)}
          required
        >
          {lifecycleEventTypes.length === 0 ? (
            <option value="">Loading event types...</option>
          ) : (
            lifecycleEventTypes.map(
              (eventType: { _id: string; type: string; name: string; amount: number }) => (
                <option key={eventType._id} value={eventType.type}>
                  {eventType.name} - {formatMoney(eventType.amount)}
                </option>
              ),
            )
          )}
        </Select>
        <Input
          label="Amount"
          type="number"
          required
          value={eventForm.amount}
          onChange={(e) => setEventForm({ ...eventForm, amount: parseFloat(e.target.value) || 0 })}
        />
        <Input
          label="Event Date"
          type="date"
          required
          value={eventForm.eventDate}
          onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
        />
        <Input
          label="Year"
          type="number"
          required
          value={eventForm.year}
          onChange={(e) => setEventForm({ ...eventForm, year: parseInt(e.target.value) })}
        />
        <Textarea
          label="Notes"
          value={eventForm.notes}
          onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
          rows={3}
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setShowEventModal(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Add Event
          </Button>
        </div>
      </form>
    </Modal>
  )
}
