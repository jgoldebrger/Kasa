'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  CreditCardIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import RecordPaymentModal from '@/app/components/payments/RecordPaymentModal'
import BatchChargeModal from '@/app/payments/_components/BatchChargeModal'
import { useToast } from '@/app/components/Toast'
import {
  Button,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
  type SortDir,
} from '@/app/components/ui'
import { netPaymentAmount } from '@/lib/money'
import { sortPaymentRows } from '@/lib/payments/sort-payments'
import { formatLocaleDate } from '@/lib/date-utils'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'
import PaymentsNav from './_components/PaymentsNav'
import { PAYMENTS_LIST_PAGE_SIZE, parsePaymentsListResponse } from '@/lib/client/payments-list'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

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

const PAYMENT_METHOD_KEYS: Record<Payment['paymentMethod'], MessageKey> = {
  cash: 'payments.method.cash',
  credit_card: 'payments.method.credit_card',
  check: 'payments.method.check',
  quick_pay: 'payments.method.quick_pay',
}

const PAYMENT_TYPE_KEYS: Record<Payment['type'], MessageKey> = {
  membership: 'payments.type.membership',
  donation: 'payments.type.donation',
  other: 'payments.type.other',
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
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const { format: formatMoney } = useCurrency()
  const serverHydrated = initialPayments !== undefined
  const [allPayments, setAllPayments] = useState<Payment[]>(initialPayments ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [loading, setLoading] = useState(!serverHydrated)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [visiblePayments, setVisiblePayments] = useState<Payment[]>([])
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null)
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [showBatchChargeModal, setShowBatchChargeModal] = useState(false)
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
          toast.error(t('payments.error.load'))
        } else {
          toast.error(t('payments.error.loadMore'))
        }
      } finally {
        if (!isStale(gen)) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [toast, begin, isStale, t],
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

  const formatPaymentMethod = useCallback(
    (payment: Payment) => {
      const paymentMethod = payment.paymentMethod || 'cash'
      const methodKey = PAYMENT_METHOD_KEYS[paymentMethod as keyof typeof PAYMENT_METHOD_KEYS]
      const method = methodKey ? t(methodKey) : t('payments.method.cash')
      if (paymentMethod === 'credit_card' && payment.ccInfo)
        return `${method} •••• ${payment.ccInfo.last4}`
      if (paymentMethod === 'check' && payment.checkInfo)
        return `${method} #${payment.checkInfo.checkNumber}`
      return method
    },
    [t],
  )

  const totalAmount = useMemo(
    () => visiblePayments.reduce((sum, p) => sum + netPaymentAmount(p), 0),
    [visiblePayments],
  )

  const sortedPayments = useMemo(() => sortPaymentRows(allPayments, sort), [allPayments, sort])

  const columns: DataColumn<Payment>[] = useMemo(
    () => [
      {
        id: 'date',
        header: t('payments.column.date'),
        headerText: t('payments.column.date'),
        sortable: true,
        cell: (p) => formatLocaleDate(p.paymentDate),
        exportValue: (p) => (p.paymentDate ? new Date(p.paymentDate) : ''),
        filter: { type: 'dateRange', getValue: (p) => p.paymentDate || null },
      },
      {
        id: 'family',
        header: t('payments.column.family'),
        headerText: t('payments.column.family'),
        sortable: true,
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
            <span className="italic text-fg-muted">{t('payments.familyDeleted')}</span>
          ),
        exportValue: (p) => p.familyId?.name || '',
        filter: { type: 'select', getValue: (p) => p.familyId?.name || '' },
      },
      {
        id: 'familyEmail',
        header: t('payments.column.familyEmail'),
        headerText: t('payments.column.familyEmail'),
        sortable: true,
        defaultHidden: true,
        cell: (p) => <span className="text-fg-muted text-sm">{p.familyId?.email || '—'}</span>,
        exportValue: (p) => p.familyId?.email || '',
      },
      {
        id: 'familyPhone',
        header: t('payments.column.familyPhone'),
        headerText: t('payments.column.familyPhone'),
        sortable: true,
        defaultHidden: true,
        cell: (p) => (
          <span className="text-fg-muted text-sm tabular">{p.familyId?.phone || '—'}</span>
        ),
        exportValue: (p) => p.familyId?.phone || '',
      },
      {
        id: 'amount',
        header: t('payments.column.amount'),
        headerText: t('payments.column.amount'),
        sortable: true,
        align: 'right',
        cell: (p) => (
          <span className="font-semibold text-success tabular">
            {formatMoney(netPaymentAmount(p))}
          </span>
        ),
        exportValue: (p) => netPaymentAmount(p),
        filter: { type: 'numberRange', getValue: (p) => netPaymentAmount(p) },
      },
      {
        id: 'type',
        header: t('payments.column.type'),
        headerText: t('payments.column.type'),
        sortable: true,
        hideBelow: 'md',
        cell: (p) => <span>{t(PAYMENT_TYPE_KEYS[p.type])}</span>,
        exportValue: (p) => p.type || '',
        filter: {
          type: 'multiselect',
          options: [
            { value: 'membership', label: t('payments.type.membership') },
            { value: 'donation', label: t('payments.type.donation') },
            { value: 'other', label: t('payments.type.other') },
          ],
        },
      },
      {
        id: 'method',
        header: t('payments.column.method'),
        headerText: t('payments.column.method'),
        sortable: true,
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
            { value: 'cash', label: t('payments.method.cash') },
            { value: 'credit_card', label: t('payments.method.credit_card') },
            { value: 'check', label: t('payments.method.check') },
            { value: 'quick_pay', label: t('payments.method.quick_pay') },
          ],
        },
      },
      {
        id: 'year',
        header: t('payments.column.year'),
        headerText: t('payments.column.year'),
        sortable: true,
        hideBelow: 'lg',
        cell: (p) => p.year,
        exportValue: (p) => p.year || '',
        filter: { type: 'select', getValue: (p) => (p.year ? String(p.year) : '') },
      },
      {
        id: 'notes',
        header: t('payments.column.notes'),
        headerText: t('payments.column.notes'),
        sortable: true,
        hideBelow: 'lg',
        defaultHidden: true,
        cell: (p) => <span className="text-fg text-sm">{p.notes || '—'}</span>,
        exportValue: (p) => p.notes || '',
      },
    ],
    [t, formatMoney, formatPaymentMethod],
  )

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('payments.title')}
          subtitle={t('payments.subtitle')}
          actions={
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              {!supportReadOnly && (
                <>
                  <Button
                    variant="secondary"
                    leftIcon={<CreditCardIcon className="h-5 w-5" aria-hidden="true" />}
                    onClick={() => setShowBatchChargeModal(true)}
                  >
                    {t('payments.batchCharge.action')}
                  </Button>
                  <Button
                    leftIcon={<PlusIcon className="h-5 w-5" />}
                    onClick={() => setShowRecordModal(true)}
                  >
                    {t('payments.recordPayment')}
                  </Button>
                </>
              )}
              <div className="text-right">
                <div className="text-xs text-fg-muted">{t('payments.totalAmount')}</div>
                <div className="text-2xl sm:text-3xl font-bold text-fg tabular">
                  {formatMoney(totalAmount)}
                </div>
              </div>
            </div>
          }
        />

        <div className="mt-4">
          <PaymentsNav />
        </div>

        {loading ? (
          <Card>
            <SkeletonRows count={8} />
          </Card>
        ) : error ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title={t('payments.loadError.title')}
            description={t('payments.loadError.description')}
            cta={{ label: t('common.retry'), onClick: () => fetchPayments() }}
          />
        ) : (
          <DataView
            tableId="payments"
            rows={sortedPayments}
            columns={columns}
            rowKey={(p) => p._id}
            sort={sort}
            onSortChange={(id, dir) => setSort({ id, dir })}
            globalSearch={{
              placeholder: t('payments.searchPlaceholder'),
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
                <Card compact>
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
                        <span className="italic text-fg-muted">{t('payments.familyDeleted')}</span>
                      )}
                      <div className="text-xs text-fg-muted mt-1">
                        {formatLocaleDate(p.paymentDate)} · {p.year}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-success tabular">
                        {formatMoney(netPaymentAmount(p))}
                      </div>
                      <div className="text-xs text-fg-muted">{t(PAYMENT_TYPE_KEYS[p.type])}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-fg">
                    <MethodIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                    {formatPaymentMethod(p)}
                  </div>
                  {p.notes && <p className="mt-2 text-xs text-fg">{p.notes}</p>}
                </Card>
              )
            }}
            empty={
              <EmptyState
                icon={<CreditCardIcon />}
                title={t('payments.empty.title')}
                description={t('payments.empty.description')}
                cta={{ label: t('payments.empty.cta'), href: '/families' }}
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

        {!loading && !error && visiblePayments.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-6">
            <SummaryCard label={t('payments.summary.total')} value={visiblePayments.length} />
            <SummaryCard
              label={t('payments.summary.cash')}
              value={visiblePayments.filter((p) => p.paymentMethod === 'cash').length}
              tone="text-success"
            />
            <SummaryCard
              label={t('payments.summary.creditCard')}
              value={visiblePayments.filter((p) => p.paymentMethod === 'credit_card').length}
              tone="text-accent"
            />
            <SummaryCard
              label={t('payments.summary.check')}
              value={visiblePayments.filter((p) => p.paymentMethod === 'check').length}
              tone="text-fg"
            />
          </div>
        )}
      </div>

      <RecordPaymentModal
        open={showRecordModal}
        onClose={() => setShowRecordModal(false)}
        onCreated={() => fetchPayments()}
      />
      <BatchChargeModal
        open={showBatchChargeModal}
        onClose={() => setShowBatchChargeModal(false)}
        onComplete={() => fetchPayments()}
      />
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
    <Card compact>
      <div className="text-xs sm:text-sm text-fg-muted">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold tabular ${tone}`}>{value}</div>
    </Card>
  )
}
