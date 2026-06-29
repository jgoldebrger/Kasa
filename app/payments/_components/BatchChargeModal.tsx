'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CreditCardIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useToast } from '@/app/components/Toast'
import { Alert, Button, Modal, SkeletonRows } from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

interface BatchChargeCandidate {
  familyId: string
  familyName: string
  amount: number
  reason: 'recurring_due' | 'negative_balance'
  savedPaymentMethodId: string
  cardLast4: string
  cardType: string
  recurringPaymentId?: string
  balance?: number
}

interface BatchChargeModalProps {
  open: boolean
  onClose: () => void
  onComplete?: () => void
}

const REASON_KEYS: Record<BatchChargeCandidate['reason'], MessageKey> = {
  recurring_due: 'payments.batchCharge.reason.recurring',
  negative_balance: 'payments.batchCharge.reason.balance',
}

function candidateId(c: BatchChargeCandidate) {
  return `${c.familyId}:${c.reason}:${c.recurringPaymentId || ''}`
}

export default function BatchChargeModal({ open, onClose, onComplete }: BatchChargeModalProps) {
  const t = useT()
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [loading, setLoading] = useState(false)
  const [charging, setCharging] = useState(false)
  const [candidates, setCandidates] = useState<BatchChargeCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [billingBlocked, setBillingBlocked] = useState<string | null>(null)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    setBillingBlocked(null)
    try {
      const res = await fetch('/api/payments/batch-charge')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const list: BatchChargeCandidate[] = data.candidates || []
      setCandidates(list)
      setSelected(new Set(list.map(candidateId)))
      if (data.billingBlocked) setBillingBlocked(data.billingBlocked)
    } catch {
      setCandidates([])
      setSelected(new Set())
      toast.error(t('payments.batchCharge.error.preview'))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    if (open) void loadPreview()
  }, [open, loadPreview])

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(candidateId(c))),
    [candidates, selected],
  )

  const totalAmount = useMemo(
    () => selectedCandidates.reduce((sum, c) => sum + c.amount, 0),
    [selectedCandidates],
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === candidates.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map(candidateId)))
    }
  }

  const handleCharge = async () => {
    if (supportReadOnly || selectedCandidates.length === 0) return
    setCharging(true)
    try {
      const res = await fetch('/api/payments/batch-charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          charges: selectedCandidates.map((c) => ({
            familyId: c.familyId,
            reason: c.reason,
            ...(c.recurringPaymentId ? { recurringPaymentId: c.recurringPaymentId } : {}),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('payments.batchCharge.error.charge'))
        return
      }
      toast.success(
        t('payments.batchCharge.success')
          .replace('{succeeded}', String(data.succeeded ?? 0))
          .replace('{failed}', String(data.failed ?? 0)),
      )
      onComplete?.()
      onClose()
    } catch {
      toast.error(t('payments.batchCharge.error.charge'))
    } finally {
      setCharging(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('payments.batchCharge.title')}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={charging}>
            {t('common.cancel')}
          </Button>
          <Button
            leftIcon={<CreditCardIcon className="h-5 w-5" aria-hidden="true" />}
            onClick={() => void handleCharge()}
            loading={charging}
            disabled={
              supportReadOnly || loading || selectedCandidates.length === 0 || !!billingBlocked
            }
          >
            {t('payments.batchCharge.confirm').replace(
              '{count}',
              String(selectedCandidates.length),
            )}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted mb-4">{t('payments.batchCharge.description')}</p>

      {billingBlocked && (
        <Alert variant="warning" className="mb-4">
          {billingBlocked}
        </Alert>
      )}

      {supportReadOnly && (
        <Alert variant="info" className="mb-4">
          {t('payments.batchCharge.readOnly')}
        </Alert>
      )}

      {loading ? (
        <SkeletonRows count={5} />
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-fg-muted">
          <ExclamationTriangleIcon className="h-8 w-8" aria-hidden="true" />
          <p>{t('payments.batchCharge.empty')}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.size === candidates.length && candidates.length > 0}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-border"
              />
              {t('payments.batchCharge.selectAll')}
            </label>
            <div className="text-sm font-medium tabular">
              {t('payments.batchCharge.total')}: {formatMoney(totalAmount)}
            </div>
          </div>
          <ul className="max-h-80 overflow-y-auto divide-y divide-border border border-border rounded-md">
            {candidates.map((c) => {
              const id = candidateId(c)
              return (
                <li key={id} className="flex items-start gap-3 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() => toggle(id)}
                    className="mt-1 h-4 w-4 rounded border-border"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-fg truncate">{c.familyName}</div>
                    <div className="text-xs text-fg-muted">
                      {t(REASON_KEYS[c.reason])} · {c.cardType} •••• {c.cardLast4}
                    </div>
                  </div>
                  <div className="tabular font-medium text-fg shrink-0">
                    {formatMoney(c.amount)}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Modal>
  )
}
