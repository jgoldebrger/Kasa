'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  CreditCardIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  BoltIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { useToast } from '@/app/components/Toast'
import {
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'
import { netPaymentAmount } from '@/lib/money'
import { formatLocaleDate } from '@/lib/date-utils'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { PAYMENTS_LIST_PAGE_SIZE, parsePaymentsListResponse } from '@/lib/client/payments-list'
import { Button } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

interface Payment {
  _id: string
  familyId: {
    _id: string
    name: string
    hebrewName?: string
    email?: string
    phone?: string
  }
  amount: number
  refundedAmount?: number
  paymentDate: string
  year: number
  type: 'membership' | 'donation' | 'other'
  paymentMethod: 'cash' | 'credit_card' | 'check' | 'quick_pay'
  ccInfo?: {
    last4: string
    cardType: string
    expiryMonth: string
    expiryYear: string
    nameOnCard: string
  }
  checkInfo?: {
    checkNumber: string
    bankName: string
    routingNumber: string
  }
  notes?: string
  createdAt: string
}

const paymentMethodIcons = {
  cash: CurrencyDollarIcon,
  credit_card: CreditCardIcon,
  check: DocumentTextIcon,
  quick_pay: BoltIcon,
}

const paymentMethodLabels = {
  cash: 'Cash',
  credit_card: 'Credit Card',
  check: 'Check',
  quick_pay: 'Quick Pay',
}

export default function PaymentsView({
  initialPayments,
  initialNextCursor = null,
}: {
  initialPayments?: Payment[]
  initialNextCursor?: string | null
} = {}) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const serverHydrated = initialPayments !== undefined
  const [allPayments, setAllPayments] = useState<Payment[]>(initialPayments ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [loading, setLoading] = useState(!serverHydrated)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [visiblePayments, setVisiblePayments] = useState<Payment[]>([])
  const hasFetchedRef = useRef(serverHydrated)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchPayments = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      const gen = begin()
      const append = opts?.append ?? false
      try {
        if (append) setLoadingMore(true)
        else {
          setLoading(true)
          setError(false)
        }
        const params = new URLSearchParams({ limit: String(PAYMENTS_LIST_PAGE_SIZE) })
        if (opts?.cursor) params.set('cursor', opts.cursor)
        const res = await fetch(`/api/payments?${params}`)
        if (isStale(gen)) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => null)
        if (isStale(gen)) return
        const { items, nextCursor: pageNext } = parsePaymentsListResponse(data)
        setAllPayments((prev) =>
          append ? [...prev, ...(items as Payment[])] : (items as Payment[]),
        )
        setNextCursor(pageNext)
      } catch {
        if (isStale(gen)) return
        if (!append) {
          setAllPayments([])
          setNextCursor(null)
          setError(true)
          toast.error('Could not load payments.')
        } else {
          toast.error('Could not load more payments.')
        }
      } finally {
        if (!isStale(gen)) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [toast, begin, isStale],
  )

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    void fetchPayments()
  }, [fetchPayments])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      hasFetchedRef.current = false
      setAllPayments([])
      setNextCursor(null)
      setLoading(true)
      hasFetchedRef.current = true
      fetchPayments()
    }, [fetchPayments, invalidate]),
  )

  const formatPaymentMethod = (payment: Payment) => {
    const paymentMethod = payment.paymentMethod || 'cash'
    const method = paymentMethodLabels[paymentMethod as keyof typeof paymentMethodLabels] || 'Cash'
    if (paymentMethod === 'credit_card' && payment.ccInfo)
      return `${method} •••• ${payment.ccInfo.last4}`
    if (paymentMethod === 'check' && payment.checkInfo)
      return `${method} #${payment.checkInfo.checkNumber}`
    return method
  }

  const totalAmount = useMemo(
    () => visiblePayments.reduce((sum, p) => sum + netPaymentAmount(p), 0),
    [visiblePayments],
  )

  const columns: DataColumn<Payment>[] = [
    {
      id: 'date',
      header: 'Date',
      headerText: 'Date',
      cell: (p) => formatLocaleDate(p.paymentDate),
      exportValue: (p) => (p.paymentDate ? new Date(p.paymentDate) : ''),
      filter: { type: 'dateRange', getValue: (p) => p.paymentDate || null },
    },
    {
      id: 'family',
      header: 'Family',
      headerText: 'Family',
      cell: (p) =>
        p.familyId ? (
          <div className="min-w-0">
            <Link
              href={`/families/${p.familyId._id}`}
              className="focus-ring text-accent hover:text-accent-hover font-medium hover:underline rounded"
            >
              {p.familyId.name}
            </Link>
            {p.familyId.email && (
              <div className="text-xs text-fg-muted mt-1 truncate">{p.familyId.email}</div>
            )}
          </div>
        ) : (
          <span className="italic text-fg-muted">(family deleted)</span>
        ),
      exportValue: (p) => p.familyId?.name || '',
      filter: { type: 'select', getValue: (p) => p.familyId?.name || '' },
    },
    {
      id: 'familyEmail',
      header: 'Family Email',
      headerText: 'Family Email',
      defaultHidden: true,
      cell: (p) => <span className="text-fg-muted text-sm">{p.familyId?.email || '—'}</span>,
      exportValue: (p) => p.familyId?.email || '',
    },
    {
      id: 'familyPhone',
      header: 'Family Phone',
      headerText: 'Family Phone',
      defaultHidden: true,
      cell: (p) => (
        <span className="text-fg-muted text-sm tabular">{p.familyId?.phone || '—'}</span>
      ),
      exportValue: (p) => p.familyId?.phone || '',
    },
    {
      id: 'amount',
      header: 'Amount',
      headerText: 'Amount',
      align: 'right',
      cell: (p) => (
        <span className="font-semibold text-green-700">{formatMoney(netPaymentAmount(p))}</span>
      ),
      exportValue: (p) => netPaymentAmount(p),
      filter: { type: 'numberRange', getValue: (p) => netPaymentAmount(p) },
    },
    {
      id: 'type',
      header: 'Type',
      headerText: 'Type',
      hideBelow: 'md',
      cell: (p) => <span className="capitalize">{p.type}</span>,
      exportValue: (p) => p.type || '',
      filter: {
        type: 'multiselect',
        options: [
          { value: 'membership', label: 'Membership' },
          { value: 'donation', label: 'Donation' },
          { value: 'other', label: 'Other' },
        ],
      },
    },
    {
      id: 'method',
      header: 'Payment Method',
      headerText: 'Payment Method',
      hideBelow: 'md',
      cell: (p) => {
        const MethodIcon =
          paymentMethodIcons[p.paymentMethod as keyof typeof paymentMethodIcons] ||
          CurrencyDollarIcon
        return (
          <div>
            <div className="flex items-center gap-2">
              <MethodIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
              <span className="text-sm">{formatPaymentMethod(p)}</span>
            </div>
            {p.paymentMethod === 'credit_card' && p.ccInfo?.cardType && (
              <div className="text-xs text-fg-muted mt-1">{p.ccInfo.cardType}</div>
            )}
            {p.paymentMethod === 'check' && p.checkInfo?.bankName && (
              <div className="text-xs text-fg-muted mt-1">{p.checkInfo.bankName}</div>
            )}
          </div>
        )
      },
      exportValue: (p) => formatPaymentMethod(p),
      filter: {
        type: 'multiselect',
        getValue: (p) => p.paymentMethod || 'cash',
        options: [
          { value: 'cash', label: 'Cash' },
          { value: 'credit_card', label: 'Credit Card' },
          { value: 'check', label: 'Check' },
          { value: 'quick_pay', label: 'Quick Pay' },
        ],
      },
    },
    {
      id: 'year',
      header: 'Year',
      headerText: 'Year',
      hideBelow: 'lg',
      cell: (p) => p.year,
      exportValue: (p) => p.year || '',
      filter: { type: 'select', getValue: (p) => (p.year ? String(p.year) : '') },
    },
    {
      id: 'notes',
      header: 'Notes',
      headerText: 'Notes',
      hideBelow: 'lg',
      defaultHidden: true,
      cell: (p) => <span className="text-fg text-sm">{p.notes || '—'}</span>,
      exportValue: (p) => p.notes || '',
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="All Payments"
          subtitle="View and manage all payments across all families."
          actions={
            <div className="text-right">
              <div className="text-xs text-fg-muted">Total Amount</div>
              <div className="text-2xl sm:text-3xl font-bold text-green-700">
                {formatMoney(totalAmount)}
              </div>
            </div>
          }
        />

        {/* Payments list */}
        {loading ? (
          <div className="surface-card rounded-2xl border border-border p-6">
            <SkeletonRows count={8} />
          </div>
        ) : error ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Couldn't load payments"
            description="Check your connection and try again."
            cta={{ label: 'Retry', onClick: () => fetchPayments() }}
          />
        ) : (
          <DataView
            tableId="payments"
            rows={allPayments}
            columns={columns}
            rowKey={(p) => p._id}
            globalSearch={{
              placeholder: 'Search family, notes, last 4, check #, date…',
              getValue: (p) =>
                [
                  p.familyId?.name,
                  p.familyId?.email,
                  p.familyId?.phone,
                  p.notes,
                  p.ccInfo?.last4,
                  p.checkInfo?.checkNumber,
                  p.checkInfo?.bankName,
                  p.paymentDate ? formatLocaleDate(p.paymentDate) : '',
                ]
                  .filter(Boolean)
                  .join(' '),
            }}
            pageSize={10}
            onFilteredRowsChange={setVisiblePayments}
            mobileCard={(p) => {
              const MethodIcon =
                paymentMethodIcons[p.paymentMethod as keyof typeof paymentMethodIcons] ||
                CurrencyDollarIcon
              return (
                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {p.familyId ? (
                        <Link
                          href={`/families/${p.familyId._id}`}
                          className="focus-ring font-semibold text-accent hover:underline rounded"
                        >
                          {p.familyId.name}
                        </Link>
                      ) : (
                        <span className="italic text-fg-muted">(family deleted)</span>
                      )}
                      <div className="text-xs text-fg-muted mt-1">
                        {formatLocaleDate(p.paymentDate)} · {p.year}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-green-700">
                        {formatMoney(netPaymentAmount(p))}
                      </div>
                      <div className="text-xs text-fg-muted capitalize">{p.type}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-fg">
                    <MethodIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                    {formatPaymentMethod(p)}
                  </div>
                  {p.notes && <p className="mt-2 text-xs text-fg">{p.notes}</p>}
                </div>
              )
            }}
            empty={
              <EmptyState
                icon={<CreditCardIcon />}
                title="No payments yet"
                description="Record a payment from a family detail page to see it here."
                cta={{ label: 'Open Families', href: '/families' }}
              />
            }
          />
        )}

        {!loading && !error && nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={loadingMore}
              onClick={() => fetchPayments({ cursor: nextCursor, append: true })}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        )}

        {/* Summary Cards reflect the currently filtered set */}
        {!loading && !error && visiblePayments.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-6">
            <SummaryCard label="Total Payments" value={visiblePayments.length} />
            <SummaryCard
              label="Cash"
              value={visiblePayments.filter((p) => p.paymentMethod === 'cash').length}
              tone="text-green-700"
            />
            <SummaryCard
              label="Credit Card"
              value={visiblePayments.filter((p) => p.paymentMethod === 'credit_card').length}
              tone="text-accent"
            />
            <SummaryCard
              label="Check"
              value={visiblePayments.filter((p) => p.paymentMethod === 'check').length}
              tone="text-purple-700"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone = 'text-fg',
}: {
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className="surface-card rounded-xl p-4 border border-border">
      <div className="text-xs sm:text-sm text-fg">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  )
}
