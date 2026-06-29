'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { CurrencyDollarIcon, DocumentTextIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Card, SkeletonRows, Button } from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'
import { formatLocaleDate } from '@/lib/date-utils'
import { useT } from '@/lib/client/i18n'
import { familyTabHref } from '../_lib/constants'
import MemberMakePaymentModal from './MemberMakePaymentModal'
import MemberEmailsSection from './MemberEmailsSection'

interface MemberPayment {
  _id: string
  amount: number
  paymentDate: string
  type?: string
  paymentMethod?: string
}

interface MemberFinancialPanelProps {
  familyId: string
  memberFinancialAccess: boolean
  initialBalance?: { balance: number } | null
  initialPayments?: MemberPayment[]
}

export default function MemberFinancialPanel({
  familyId,
  memberFinancialAccess,
  initialBalance,
  initialPayments,
}: MemberFinancialPanelProps) {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const [balance, setBalance] = useState(initialBalance?.balance ?? null)
  const [payments, setPayments] = useState<MemberPayment[]>(initialPayments ?? [])
  const [cardPaymentsEnabled, setCardPaymentsEnabled] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [payBalanceMode, setPayBalanceMode] = useState(false)
  const [loading, setLoading] = useState(memberFinancialAccess && initialBalance == null)
  const [denied, setDenied] = useState(!memberFinancialAccess)

  const load = useCallback(async () => {
    if (!memberFinancialAccess) {
      setDenied(true)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/families/${familyId}/member-financials`)
      if (res.status === 403) {
        setDenied(true)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBalance(data.balance?.balance ?? 0)
      setPayments(Array.isArray(data.payments) ? data.payments : [])
      setCardPaymentsEnabled(Boolean(data.cardPaymentsEnabled))
      setDenied(false)
    } catch {
      setDenied(true)
    } finally {
      setLoading(false)
    }
  }, [familyId, memberFinancialAccess])

  useEffect(() => {
    if (memberFinancialAccess && initialBalance == null) {
      void load()
    }
  }, [memberFinancialAccess, initialBalance, load])

  if (denied) {
    return (
      <Card compact className="border-dashed">
        <p className="text-sm text-fg-muted">{t('memberPortal.noFinancialAccess')}</p>
        <p className="mt-1 text-xs text-fg-subtle">{t('memberPortal.noFinancialAccessHint')}</p>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <SkeletonRows count={3} />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card compact>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
              {t('memberPortal.currentBalance')}
            </p>
            <p className="mt-1 text-2xl font-bold tabular text-fg">{formatMoney(balance ?? 0)}</p>
          </div>
          <div className="rounded-md bg-accent/10 p-2 text-accent" aria-hidden="true">
            <CurrencyDollarIcon className="h-6 w-6" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {(balance ?? 0) > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setPayBalanceMode(true)
                setPaymentModalOpen(true)
              }}
              className="inline-flex items-center gap-1.5"
            >
              <CurrencyDollarIcon className="h-4 w-4" aria-hidden="true" />
              {t('memberPortal.payBalance')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setPayBalanceMode(false)
              setPaymentModalOpen(true)
            }}
            className="inline-flex items-center gap-1.5"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            {t('memberPortal.makePayment')}
          </Button>
          <Link
            href={familyTabHref(familyId, 'statements')}
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
          >
            <DocumentTextIcon className="h-4 w-4" aria-hidden="true" />
            {t('memberPortal.viewStatements')}
          </Link>
        </div>
      </Card>

      <MemberMakePaymentModal
        open={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false)
          setPayBalanceMode(false)
        }}
        familyId={familyId}
        cardPaymentsEnabled={cardPaymentsEnabled}
        initialAmount={payBalanceMode ? (balance ?? 0) : undefined}
        onSuccess={() => void load()}
      />

      {payments.length > 0 && (
        <Card compact>
          <h4 className="mb-3 text-sm font-semibold text-fg">{t('memberPortal.recentPayments')}</h4>
          <ul className="divide-y divide-border">
            {payments.map((p) => (
              <li key={p._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-fg-muted tabular">{formatLocaleDate(p.paymentDate)}</span>
                <span className="font-medium tabular text-fg">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <MemberEmailsSection familyId={familyId} />
    </div>
  )
}
