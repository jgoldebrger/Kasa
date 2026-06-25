'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/components/Toast'
import { Button, Input, Modal, Select, Textarea } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

const StripePaymentForm = dynamic(() => import('@/app/components/StripePaymentForm'), {
  ssr: false,
  loading: () => (
    <div className="py-4 text-center text-sm text-fg-muted">Preparing secure payment…</div>
  ),
})

const PAYMENT_TYPE_KEYS = {
  membership: 'payments.type.membership',
  donation: 'payments.type.donation',
  other: 'payments.type.other',
} as const satisfies Record<string, MessageKey>

const OFFLINE_METHOD_KEYS = {
  cash: 'payments.method.cash',
  check: 'payments.method.check',
  quick_pay: 'payments.method.quick_pay',
} as const satisfies Record<string, MessageKey>

type OfflineMethod = keyof typeof OFFLINE_METHOD_KEYS
type PaymentMethod = OfflineMethod | 'credit_card'

interface SavedCard {
  _id: string
  last4: string
  cardType: string
  expiryMonth: string
  expiryYear: string
  nameOnCard?: string
  isDefault?: boolean
}

export interface MemberMakePaymentModalProps {
  open: boolean
  onClose: () => void
  familyId: string
  cardPaymentsEnabled: boolean
  onSuccess?: () => void
}

const buildForm = () => ({
  amount: 0,
  paymentDate: new Date().toISOString().split('T')[0],
  type: 'membership' as 'membership' | 'donation' | 'other',
  paymentMethod: 'credit_card' as PaymentMethod,
  notes: '',
  saveCard: true,
  useSavedCard: false,
  selectedSavedCardId: '',
})

export default function MemberMakePaymentModal({
  open,
  onClose,
  familyId,
  cardPaymentsEnabled,
  onSuccess,
}: MemberMakePaymentModalProps) {
  const t = useT()
  const toast = useToast()
  const [form, setForm] = useState(buildForm)
  const [submitting, setSubmitting] = useState(false)
  const [savedCards, setSavedCards] = useState<SavedCard[]>([])
  const cardsFetchedRef = useRef(false)

  useEffect(() => {
    if (open) {
      setForm({
        ...buildForm(),
        paymentMethod: cardPaymentsEnabled ? 'credit_card' : 'cash',
      })
      cardsFetchedRef.current = false
    }
  }, [open, cardPaymentsEnabled])

  const fetchSavedCards = useCallback(async () => {
    if (!familyId) return
    try {
      const res = await fetch(`/api/families/${familyId}/saved-payment-methods`)
      if (res.ok) {
        const data = await res.json().catch(() => [])
        setSavedCards(Array.isArray(data) ? data : [])
      }
    } catch {
      setSavedCards([])
    }
  }, [familyId])

  useEffect(() => {
    if (!open || !cardPaymentsEnabled || form.paymentMethod !== 'credit_card') return
    if (cardsFetchedRef.current) return
    cardsFetchedRef.current = true
    void fetchSavedCards()
  }, [open, cardPaymentsEnabled, form.paymentMethod, fetchSavedCards])

  const handleClose = () => {
    if (!submitting) onClose()
  }

  const submitOffline = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.amount || form.amount <= 0) {
      toast.error(t('payments.recordModal.invalidAmount'))
      return
    }

    setSubmitting(true)
    try {
      const year = new Date(form.paymentDate).getFullYear()
      const res = await fetch(`/api/families/${familyId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: form.amount,
          paymentDate: form.paymentDate,
          year,
          type: form.type,
          paymentMethod: form.paymentMethod,
          notes: form.notes || undefined,
        }),
      })
      if (res.ok) {
        toast.success(t('memberPortal.makePaymentModal.success'))
        onClose()
        onSuccess?.()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || t('memberPortal.makePaymentModal.error'))
      }
    } catch {
      toast.error(t('memberPortal.makePaymentModal.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const submitSavedCard = async () => {
    if (!form.amount || form.amount <= 0) {
      toast.error(t('payments.recordModal.invalidAmount'))
      return
    }
    if (!form.selectedSavedCardId) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/families/${familyId}/charge-saved-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          savedPaymentMethodId: form.selectedSavedCardId,
          amount: form.amount,
          paymentDate: form.paymentDate,
          year: new Date(form.paymentDate).getFullYear(),
          type: form.type,
          notes: form.notes || undefined,
          paymentFrequency: 'one-time',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        toast.success(t('memberPortal.makePaymentModal.success'))
        onClose()
        onSuccess?.()
      } else {
        toast.error(data.error || t('memberPortal.makePaymentModal.error'))
      }
    } catch {
      toast.error(t('memberPortal.makePaymentModal.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const showStripe =
    cardPaymentsEnabled &&
    form.paymentMethod === 'credit_card' &&
    !form.useSavedCard &&
    form.amount > 0

  const showSavedCardCharge =
    cardPaymentsEnabled &&
    form.paymentMethod === 'credit_card' &&
    form.useSavedCard &&
    form.selectedSavedCardId

  const methodOptions: PaymentMethod[] = cardPaymentsEnabled
    ? ['credit_card', 'cash', 'check', 'quick_pay']
    : ['cash', 'check', 'quick_pay']

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('memberPortal.makePaymentModal.title')}
      maxWidth="max-w-lg"
    >
      <form
        onSubmit={
          form.paymentMethod === 'credit_card'
            ? (e) => {
                e.preventDefault()
                if (showSavedCardCharge) void submitSavedCard()
              }
            : submitOffline
        }
        className="space-y-4"
        noValidate
      >
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
          onChange={(e) => {
            const method = e.target.value as PaymentMethod
            setForm({
              ...form,
              paymentMethod: method,
              useSavedCard: false,
              selectedSavedCardId: '',
            })
          }}
        >
          {methodOptions.map((key) => (
            <option key={key} value={key}>
              {key === 'credit_card'
                ? t('payments.method.credit_card')
                : t(OFFLINE_METHOD_KEYS[key])}
            </option>
          ))}
        </Select>

        {cardPaymentsEnabled && form.paymentMethod === 'credit_card' && savedCards.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border bg-app-subtle p-3">
            <p className="text-sm font-medium text-fg">
              {t('memberPortal.makePaymentModal.savedCards')}
            </p>
            {savedCards.map((card) => (
              <label
                key={card._id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                  form.useSavedCard && form.selectedSavedCardId === card._id
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface'
                }`}
              >
                <input
                  type="radio"
                  name="memberSavedCard"
                  checked={form.useSavedCard && form.selectedSavedCardId === card._id}
                  onChange={() =>
                    setForm({
                      ...form,
                      useSavedCard: true,
                      selectedSavedCardId: card._id,
                    })
                  }
                />
                <span className="text-sm text-fg">
                  {card.cardType.toUpperCase()} •••• {card.last4}
                </span>
              </label>
            ))}
            <button
              type="button"
              className="text-sm font-medium text-accent hover:text-accent-hover"
              onClick={() => setForm({ ...form, useSavedCard: false, selectedSavedCardId: '' })}
            >
              {t('memberPortal.makePaymentModal.useNewCard')}
            </button>
          </div>
        )}

        {showStripe && (
          <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.saveCard}
                onChange={(e) => setForm({ ...form, saveCard: e.target.checked })}
                className="rounded"
              />
              <span>{t('memberPortal.makePaymentModal.saveCard')}</span>
            </label>
            <StripePaymentForm
              amount={form.amount}
              familyId={familyId}
              paymentDate={form.paymentDate}
              year={new Date(form.paymentDate).getFullYear()}
              type={form.type}
              notes={form.notes}
              saveCard={form.saveCard}
              paymentFrequency="one-time"
              onSuccess={() => {
                toast.success(t('memberPortal.makePaymentModal.success'))
                onClose()
                onSuccess?.()
              }}
              onError={(error) => toast.error(error)}
            />
          </div>
        )}

        <Textarea
          label={t('common.notes')}
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        {form.paymentMethod !== 'credit_card' || showSavedCardCharge ? (
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={form.paymentMethod === 'credit_card' && !form.selectedSavedCardId}
            >
              {t('memberPortal.makePaymentModal.submit')}
            </Button>
          </div>
        ) : !showStripe ? (
          <div className="flex justify-end pt-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
