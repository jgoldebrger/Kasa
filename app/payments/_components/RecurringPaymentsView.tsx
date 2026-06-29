'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowPathIcon, CreditCardIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'
import { formatLocaleDate } from '@/lib/date-utils'
import { useCurrency } from '@/lib/client/useCurrency'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import PaymentsNav from './PaymentsNav'

export interface RecurringPaymentRow {
  _id: string
  familyId: {
    _id: string
    name: string
    email?: string
    deletedAt?: string | null
  } | null
  amount: number
  frequency: string
  nextPaymentDate: string
  isActive: boolean
  savedPaymentMethod: {
    _id: string
    last4: string
    cardType: string
    expiryMonth: number
    expiryYear: number
    isActive: boolean
  } | null
  lastStatus: 'success' | 'failed' | 'overdue' | 'scheduled'
  lastStatusAt?: string
  lastError?: string
  isOverdue: boolean
}

export interface FailedRecurringRow {
  recurringPaymentId: string
  familyId: string
  familyName: string
  amount: number
  nextPaymentDate: string
  savedPaymentMethodId: string
  cardLabel: string
  lastError?: string
  taskId?: string
}

const STATUS_KEYS: Record<RecurringPaymentRow['lastStatus'], MessageKey> = {
  success: 'payments.recurring.status.success',
  failed: 'payments.recurring.status.failed',
  overdue: 'payments.recurring.status.overdue',
  scheduled: 'payments.recurring.status.scheduled',
}

function statusVariant(
  status: RecurringPaymentRow['lastStatus'],
): 'default' | 'success' | 'warning' | 'danger' {
  if (status === 'success') return 'success'
  if (status === 'scheduled') return 'default'
  if (status === 'overdue') return 'warning'
  return 'danger'
}

export default function RecurringPaymentsView() {
  const t = useT()
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [rows, setRows] = useState<RecurringPaymentRow[]>([])
  const [failedQueue, setFailedQueue] = useState<FailedRecurringRow[]>([])
  const [loading, setLoading] = useState(true)
  const [processingAll, setProcessingAll] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/recurring-payments')
      if (!res.ok) throw new Error('Failed to load recurring payments')
      const data = await res.json()
      setRows((data.recurringPayments ?? []) as RecurringPaymentRow[])
      setFailedQueue((data.failedQueue ?? []) as FailedRecurringRow[])
    } catch {
      toast.error(t('payments.recurring.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    void load()
  }, [load])

  useOrgChanged(() => {
    void load()
  })

  const processAllDue = useCallback(async () => {
    if (supportReadOnly) return
    setProcessingAll(true)
    try {
      const res = await fetch('/api/recurring-payments/process', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('payments.recurring.processError'))
        return
      }
      const processed = data.processed ?? 0
      const failed = data.failed ?? 0
      toast.success(
        t('payments.recurring.processSuccess')
          .replace('{processed}', String(processed))
          .replace('{failed}', String(failed)),
      )
      await load()
    } catch {
      toast.error(t('payments.recurring.processError'))
    } finally {
      setProcessingAll(false)
    }
  }, [load, supportReadOnly, t, toast])

  const retryCharge = useCallback(
    async (row: FailedRecurringRow) => {
      if (supportReadOnly) return
      setRetryingId(row.recurringPaymentId)
      try {
        const res = await fetch(`/api/families/${row.familyId}/charge-saved-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            savedPaymentMethodId: row.savedPaymentMethodId,
            amount: row.amount,
            paymentFrequency: 'monthly',
            notes: 'Manual retry from recurring payments recovery queue',
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || t('payments.recurring.retryError'))
          return
        }
        toast.success(t('payments.recurring.retrySuccess').replace('{family}', row.familyName))
        await load()
      } catch {
        toast.error(t('payments.recurring.retryError'))
      } finally {
        setRetryingId(null)
      }
    },
    [load, supportReadOnly, t, toast],
  )

  const columns = useMemo<DataColumn<RecurringPaymentRow>[]>(
    () => [
      {
        id: 'family',
        header: t('payments.column.family'),
        sortable: true,
        cell: (r) =>
          r.familyId && !r.familyId.deletedAt ? (
            <Link
              href={`/families/${r.familyId._id}`}
              className="focus-ring font-medium text-accent hover:underline rounded"
            >
              {r.familyId.name}
            </Link>
          ) : (
            <span className="italic text-fg-muted">{t('payments.familyDeleted')}</span>
          ),
      },
      {
        id: 'amount',
        header: t('payments.column.amount'),
        sortable: true,
        cell: (r) => <span className="tabular font-medium">{formatMoney(r.amount)}</span>,
        className: 'text-right',
      },
      {
        id: 'nextDate',
        header: t('payments.recurring.column.nextDate'),
        sortable: true,
        cell: (r) => formatLocaleDate(r.nextPaymentDate),
      },
      {
        id: 'card',
        header: t('payments.recurring.column.card'),
        cell: (r) =>
          r.savedPaymentMethod ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <CreditCardIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
              {r.savedPaymentMethod.cardType} •••• {r.savedPaymentMethod.last4}
            </span>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        id: 'lastStatus',
        header: t('payments.recurring.column.lastStatus'),
        sortable: true,
        cell: (r) => (
          <Badge variant={statusVariant(r.lastStatus)}>{t(STATUS_KEYS[r.lastStatus])}</Badge>
        ),
      },
    ],
    [formatMoney, t],
  )

  const failedColumns = useMemo<DataColumn<FailedRecurringRow>[]>(
    () => [
      {
        id: 'family',
        header: t('payments.column.family'),
        cell: (r) => (
          <Link
            href={`/families/${r.familyId}`}
            className="focus-ring font-medium text-accent hover:underline rounded"
          >
            {r.familyName}
          </Link>
        ),
      },
      {
        id: 'amount',
        header: t('payments.column.amount'),
        cell: (r) => <span className="tabular font-medium">{formatMoney(r.amount)}</span>,
        className: 'text-right',
      },
      {
        id: 'due',
        header: t('payments.recurring.column.dueSince'),
        cell: (r) => formatLocaleDate(r.nextPaymentDate),
      },
      {
        id: 'card',
        header: t('payments.recurring.column.card'),
        cell: (r) => r.cardLabel,
      },
      {
        id: 'error',
        header: t('payments.recurring.column.error'),
        cell: (r) => (
          <span className="text-sm text-danger max-w-xs truncate" title={r.lastError}>
            {r.lastError || '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('payments.recurring.column.actions'),
        cell: (r) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={retryingId === r.recurringPaymentId}
              disabled={supportReadOnly}
              onClick={() => void retryCharge(r)}
            >
              {t('payments.recurring.retry')}
            </Button>
            {r.taskId && (
              <ButtonLink href="/tasks" variant="ghost" size="sm">
                {t('payments.recurring.viewTask')}
              </ButtonLink>
            )}
          </div>
        ),
      },
    ],
    [formatMoney, retryCharge, retryingId, supportReadOnly, t],
  )

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={t('payments.recurring.title')}
          subtitle={t('payments.recurring.subtitle')}
          actions={
            !supportReadOnly && failedQueue.length > 0 ? (
              <Button
                loading={processingAll}
                leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                onClick={() => void processAllDue()}
              >
                {t('payments.recurring.processAll')}
              </Button>
            ) : undefined
          }
        />

        <PaymentsNav />

        {failedQueue.length > 0 && (
          <Card>
            <div className="flex items-start gap-3 mb-4">
              <ExclamationTriangleIcon
                className="h-5 w-5 text-warning shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-base font-semibold text-fg">
                  {t('payments.recurring.failedTitle')}
                </h2>
                <p className="text-sm text-fg-muted mt-1">
                  {t('payments.recurring.failedSubtitle')}
                </p>
              </div>
            </div>
            <DataView
              columns={failedColumns}
              rows={failedQueue}
              rowKey={(r) => r.recurringPaymentId}
              mobileCard={(r) => (
                <Card compact>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/families/${r.familyId}`}
                        className="focus-ring font-semibold text-accent hover:underline rounded"
                      >
                        {r.familyName}
                      </Link>
                      <p className="text-xs text-fg-muted mt-1">
                        {t('payments.recurring.column.dueSince')}:{' '}
                        {formatLocaleDate(r.nextPaymentDate)}
                      </p>
                      <p className="text-xs text-fg-muted">{r.cardLabel}</p>
                      {r.lastError && <p className="text-xs text-danger mt-2">{r.lastError}</p>}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular">{formatMoney(r.amount)}</div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        loading={retryingId === r.recurringPaymentId}
                        disabled={supportReadOnly}
                        onClick={() => void retryCharge(r)}
                      >
                        {t('payments.recurring.retry')}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            />
          </Card>
        )}

        {loading ? (
          <Card>
            <SkeletonRows count={6} />
          </Card>
        ) : (
          <DataView
            columns={columns}
            rows={rows}
            rowKey={(r) => r._id}
            tableId="recurring-payments"
            globalSearch={{
              placeholder: t('payments.recurring.searchPlaceholder'),
              getValue: (r) =>
                [r.familyId?.name, r.savedPaymentMethod?.last4, r.savedPaymentMethod?.cardType]
                  .filter(Boolean)
                  .join(' '),
            }}
            mobileCard={(r) => (
              <Card compact>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {r.familyId && !r.familyId.deletedAt ? (
                      <Link
                        href={`/families/${r.familyId._id}`}
                        className="focus-ring font-semibold text-accent hover:underline rounded"
                      >
                        {r.familyId.name}
                      </Link>
                    ) : (
                      <span className="italic text-fg-muted">{t('payments.familyDeleted')}</span>
                    )}
                    <p className="text-xs text-fg-muted mt-1">
                      {t('payments.recurring.column.nextDate')}:{' '}
                      {formatLocaleDate(r.nextPaymentDate)}
                    </p>
                    {r.savedPaymentMethod && (
                      <p className="text-xs text-fg-muted">
                        {r.savedPaymentMethod.cardType} •••• {r.savedPaymentMethod.last4}
                      </p>
                    )}
                  </div>
                  <div className="text-right space-y-1">
                    <div className="font-semibold tabular">{formatMoney(r.amount)}</div>
                    <Badge variant={statusVariant(r.lastStatus)}>
                      {t(STATUS_KEYS[r.lastStatus])}
                    </Badge>
                  </div>
                </div>
              </Card>
            )}
            empty={
              <EmptyState
                icon={<CreditCardIcon />}
                title={t('payments.recurring.empty.title')}
                description={t('payments.recurring.empty.description')}
                cta={{ label: t('payments.empty.cta'), href: '/families' }}
              />
            }
          />
        )}
      </div>
    </div>
  )
}
