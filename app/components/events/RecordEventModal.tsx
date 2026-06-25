'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useCurrency } from '@/lib/client/useCurrency'
import {
  FAMILIES_LIST_PAGE_SIZE,
  familiesListUrl,
  parseFamiliesListResponse,
} from '@/lib/client/families-list'
import { Button, Input, Modal, Select, Textarea } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

export interface LifecycleEventType {
  _id: string
  type: string
  name: string
  amount: number
}

export interface RecordEventDefaults {
  familyId?: string
}

export interface RecordEventModalProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  defaults?: RecordEventDefaults
  lockFamily?: boolean
}

const buildEmptyForm = (eventTypes: LifecycleEventType[], defaults?: RecordEventDefaults) => {
  const first = eventTypes[0]
  return {
    familyId: defaults?.familyId ?? '',
    eventType: first?.type ?? '',
    amount: first?.amount ?? 0,
    eventDate: new Date().toISOString().split('T')[0],
    notes: '',
  }
}

export default function RecordEventModal({
  open,
  onClose,
  onCreated,
  defaults,
  lockFamily,
}: RecordEventModalProps) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const [form, setForm] = useState(() => buildEmptyForm([], defaults))
  const [submitting, setSubmitting] = useState(false)
  const [families, setFamilies] = useState<any[]>([])
  const [eventTypes, setEventTypes] = useState<LifecycleEventType[]>([])
  const hasFetchedFamiliesRef = useRef(false)
  const hasFetchedEventTypesRef = useRef(false)
  const fetchGenRef = useRef(0)

  const resetForm = useCallback(
    (types: LifecycleEventType[]) => setForm(buildEmptyForm(types, defaults)),
    [defaults],
  )

  useEffect(() => {
    if (open) resetForm(eventTypes)
    // Only reset when the modal opens — not when event types load later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults])

  useEffect(() => {
    if (!open || eventTypes.length === 0) return
    setForm((prev) => {
      if (prev.eventType) return prev
      const first = eventTypes[0]
      return { ...prev, eventType: first.type, amount: first.amount }
    })
  }, [open, eventTypes])

  const fetchFamilies = useCallback(async () => {
    const gen = ++fetchGenRef.current
    try {
      const data = await cachedFetch<any>(familiesListUrl(null, FAMILIES_LIST_PAGE_SIZE), {
        ttl: 30_000,
      })
      if (fetchGenRef.current !== gen) return
      const { items } = parseFamiliesListResponse(data)
      if (items.length > 0) setFamilies(items)
    } catch {
      // Best-effort.
    }
  }, [])

  const fetchEventTypes = useCallback(async () => {
    const gen = ++fetchGenRef.current
    try {
      const data = await cachedFetch<LifecycleEventType[]>('/api/lifecycle-event-types', {
        ttl: 30_000,
      })
      if (fetchGenRef.current !== gen) return
      const types = Array.isArray(data) ? data : []
      setEventTypes(types)
    } catch {
      // Best-effort.
    }
  }, [])

  useOrgChanged(
    useCallback(() => {
      fetchGenRef.current += 1
      hasFetchedFamiliesRef.current = false
      hasFetchedEventTypesRef.current = false
      setFamilies([])
      setEventTypes([])
      invalidateCache(/^\/api\/(families|lifecycle-event-types)/)
      if (open) {
        hasFetchedFamiliesRef.current = true
        hasFetchedEventTypesRef.current = true
        void fetchFamilies()
        void fetchEventTypes()
      }
    }, [open, fetchFamilies, fetchEventTypes]),
  )

  useEffect(() => {
    if (!open) return
    if (!hasFetchedFamiliesRef.current) {
      hasFetchedFamiliesRef.current = true
      void fetchFamilies()
    }
    if (!hasFetchedEventTypesRef.current) {
      hasFetchedEventTypesRef.current = true
      void fetchEventTypes()
    }
  }, [open, fetchFamilies, fetchEventTypes])

  const updateEventType = (type: string) => {
    const matched = eventTypes.find((ev) => ev.type === type)
    setForm({ ...form, eventType: type, amount: matched?.amount ?? 0 })
  }

  const submitEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.familyId) {
      toast.error(t('events.recordModal.familyRequired'))
      return
    }
    if (!form.eventType) {
      toast.error(t('events.recordModal.eventTypeRequired'))
      return
    }

    setSubmitting(true)
    try {
      const year = new Date(form.eventDate).getFullYear()
      const res = await fetch(`/api/families/${form.familyId}/lifecycle-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId: form.familyId,
          eventType: form.eventType,
          amount: form.amount,
          eventDate: form.eventDate,
          year,
          notes: form.notes || undefined,
        }),
      })
      if (res.ok) {
        onClose()
        resetForm(eventTypes)
        toast.success(t('events.recordModal.success'))
        onCreated?.()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || t('events.recordModal.error'))
      }
    } catch {
      toast.error(t('events.recordModal.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('events.recordModal.title')} maxWidth="max-w-lg">
      <form onSubmit={submitEvent} className="space-y-4" noValidate>
        {!lockFamily && (
          <Select
            label={t('events.recordModal.family')}
            required
            value={form.familyId}
            onChange={(e) => setForm({ ...form, familyId: e.target.value })}
          >
            <option value="">{t('events.recordModal.selectFamily')}</option>
            {families.map((family) => (
              <option key={family._id} value={family._id}>
                {family.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          label={t('events.recordModal.eventType')}
          value={form.eventType}
          onChange={(e) => updateEventType(e.target.value)}
          required
        >
          {eventTypes.length === 0 ? (
            <option value="">{t('events.recordModal.loadingTypes')}</option>
          ) : (
            eventTypes.map((eventType) => (
              <option key={eventType._id} value={eventType.type}>
                {eventType.name} — {formatMoney(eventType.amount)}
              </option>
            ))
          )}
        </Select>
        <Input
          label={t('events.recordModal.amount')}
          type="number"
          required
          min="0"
          step="0.01"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
        />
        <Input
          label={t('events.recordModal.eventDate')}
          type="date"
          required
          value={form.eventDate}
          onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
        />
        <Textarea
          label={t('common.notes')}
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('events.recordModal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
