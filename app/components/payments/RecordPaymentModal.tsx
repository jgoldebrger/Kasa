'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import {
  FAMILIES_LIST_PAGE_SIZE,
  familiesListUrl,
  parseFamiliesListResponse,
} from '@/lib/client/families-list'
import { Button, Input, Modal, Select, Textarea } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

export interface RecordPaymentDefaults {
  familyId?: string
}

export interface RecordPaymentModalProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  defaults?: RecordPaymentDefaults
  lockFamily?: boolean
}

const PAYMENT_TYPE_KEYS = {
  membership: 'payments.type.membership',
  donation: 'payments.type.donation',
  other: 'payments.type.other',
} as const satisfies Record<string, MessageKey>

const PAYMENT_METHOD_KEYS = {
  cash: 'payments.method.cash',
  credit_card: 'payments.method.credit_card',
  check: 'payments.method.check',
  quick_pay: 'payments.method.quick_pay',
} as const satisfies Record<string, MessageKey>

const buildEmptyForm = (defaults?: RecordPaymentDefaults) => ({
  familyId: defaults?.familyId ?? '',
  amount: 0,
  paymentDate: new Date().toISOString().split('T')[0],
  type: 'membership' as 'membership' | 'donation' | 'other',
  paymentMethod: 'cash' as 'cash' | 'credit_card' | 'check' | 'quick_pay',
  notes: '',
})

export default function RecordPaymentModal({
  open,
  onClose,
  onCreated,
  defaults,
  lockFamily,
}: RecordPaymentModalProps) {
  const toast = useToast()
  const t = useT()
  const [form, setForm] = useState(() => buildEmptyForm(defaults))
  const [submitting, setSubmitting] = useState(false)
  const [families, setFamilies] = useState<any[]>([])
  const hasFetchedFamiliesRef = useRef(false)
  const fetchGenRef = useRef(0)

  useEffect(() => {
    if (open) setForm(buildEmptyForm(defaults))
  }, [open, defaults])

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

  useOrgChanged(
    useCallback(() => {
      fetchGenRef.current += 1
      hasFetchedFamiliesRef.current = false
      setFamilies([])
      invalidateCache(/^\/api\/families/)
      if (open) {
        hasFetchedFamiliesRef.current = true
        void fetchFamilies()
      }
    }, [open, fetchFamilies]),
  )

  useEffect(() => {
    if (!open) return
    if (hasFetchedFamiliesRef.current) return
    hasFetchedFamiliesRef.current = true
    void fetchFamilies()
  }, [open, fetchFamilies])

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.familyId) {
      toast.error(t('payments.recordModal.familyRequired'))
      return
    }
    if (!form.amount || form.amount <= 0) {
      toast.error(t('payments.recordModal.invalidAmount'))
      return
    }

    setSubmitting(true)
    try {
      const paymentDate = form.paymentDate
      const year = new Date(paymentDate).getFullYear()
      const res = await fetch(`/api/families/${form.familyId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId: form.familyId,
          amount: form.amount,
          paymentDate,
          year,
          type: form.type,
          paymentMethod: form.paymentMethod,
          notes: form.notes || undefined,
        }),
      })
      if (res.ok) {
        onClose()
        setForm(buildEmptyForm(defaults))
        toast.success(t('payments.recordModal.success'))
        onCreated?.()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || t('payments.recordModal.error'))
      }
    } catch {
      toast.error(t('payments.recordModal.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('payments.recordModal.title')}
      maxWidth="max-w-lg"
    >
      <form onSubmit={submitPayment} className="space-y-4" noValidate>
        {!lockFamily && (
          <Select
            label={t('payments.recordModal.family')}
            required
            value={form.familyId}
            onChange={(e) => setForm({ ...form, familyId: e.target.value })}
          >
            <option value="">{t('payments.recordModal.selectFamily')}</option>
            {families.map((family) => (
              <option key={family._id} value={family._id}>
                {family.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          label={t('payments.recordModal.amount')}
          type="number"
          required
          min="0.01"
          step="0.01"
          value={form.amount || ''}
          onChange={(e) =>
            setForm({ ...form, amount: e.target.value ? parseFloat(e.target.value) : 0 })
          }
        />
        <Input
          label={t('payments.recordModal.date')}
          type="date"
          required
          value={form.paymentDate}
          onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
        />
        <Select
          label={t('payments.recordModal.type')}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
        >
          {(Object.keys(PAYMENT_TYPE_KEYS) as Array<keyof typeof PAYMENT_TYPE_KEYS>).map((key) => (
            <option key={key} value={key}>
              {t(PAYMENT_TYPE_KEYS[key])}
            </option>
          ))}
        </Select>
        <Select
          label={t('payments.recordModal.method')}
          value={form.paymentMethod}
          onChange={(e) =>
            setForm({ ...form, paymentMethod: e.target.value as typeof form.paymentMethod })
          }
        >
          {(Object.keys(PAYMENT_METHOD_KEYS) as Array<keyof typeof PAYMENT_METHOD_KEYS>).map(
            (key) => (
              <option key={key} value={key}>
                {t(PAYMENT_METHOD_KEYS[key])}
              </option>
            ),
          )}
        </Select>
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
            {t('payments.recordModal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
