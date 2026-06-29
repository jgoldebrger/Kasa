'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExclamationTriangleIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline'
import {
  Badge,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tabs,
  type DataColumn,
  type SortDir,
  type BadgeProps,
} from '@/app/components/ui'
import { formatLocaleDate } from '@/lib/date-utils'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import PaymentsNav from '../_components/PaymentsNav'

type DisputeFilter = 'open' | 'closed' | 'all'

interface DisputePayment {
  _id: string
  disputedAt?: string
  disputeStatus?: string
  netAmount: number
  paymentDate: string
  familyId?: {
    _id: string
    name: string
    email?: string
  } | null
  task?: {
    _id: string
    title: string
    status: string
    dueDate: string
  } | null
}

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  needs_response: 'danger',
  warning_needs_response: 'danger',
  under_review: 'warning',
  warning_under_review: 'warning',
  won: 'success',
  lost: 'danger',
  warning_closed: 'muted',
  charge_refunded: 'muted',
}

const STATUS_KEYS: Record<string, MessageKey> = {
  needs_response: 'payments.disputes.status.needs_response',
  warning_needs_response: 'payments.disputes.status.warning_needs_response',
  under_review: 'payments.disputes.status.under_review',
  warning_under_review: 'payments.disputes.status.warning_under_review',
  won: 'payments.disputes.status.won',
  lost: 'payments.disputes.status.lost',
  warning_closed: 'payments.disputes.status.warning_closed',
  charge_refunded: 'payments.disputes.status.charge_refunded',
}

export default function DisputesView() {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const [filter, setFilter] = useState<DisputeFilter>('open')
  const [items, setItems] = useState<DisputePayment[]>([])
  const [counts, setCounts] = useState({ open: 0, closed: 0, all: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null)

  const fetchDisputes = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/payments/disputes?status=${filter}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setCounts(data.counts || { open: 0, closed: 0, all: 0 })
    } catch {
      setItems([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void fetchDisputes()
  }, [fetchDisputes])

  useOrgChanged(() => {
    void fetchDisputes()
  })

  const columns: DataColumn<DisputePayment>[] = useMemo(
    () => [
      {
        id: 'disputedAt',
        header: t('payments.disputes.column.opened'),
        headerText: t('payments.disputes.column.opened'),
        sortable: true,
        cell: (p) => (p.disputedAt ? formatLocaleDate(p.disputedAt) : '—'),
      },
      {
        id: 'family',
        header: t('payments.column.family'),
        headerText: t('payments.column.family'),
        sortable: true,
        cell: (p) =>
          p.familyId?._id ? (
            <Link href={`/families/${p.familyId._id}`} className="text-accent hover:underline">
              {p.familyId.name}
            </Link>
          ) : (
            t('payments.familyDeleted')
          ),
      },
      {
        id: 'amount',
        header: t('payments.column.amount'),
        headerText: t('payments.column.amount'),
        sortable: true,
        cell: (p) => <span className="tabular font-medium">{formatMoney(p.netAmount)}</span>,
      },
      {
        id: 'status',
        header: t('payments.disputes.column.status'),
        headerText: t('payments.disputes.column.status'),
        sortable: true,
        cell: (p) => {
          const key = p.disputeStatus || 'needs_response'
          const labelKey = STATUS_KEYS[key]
          return (
            <Badge variant={STATUS_VARIANT[key] || 'warning'}>{labelKey ? t(labelKey) : key}</Badge>
          )
        },
      },
      {
        id: 'payment',
        header: t('payments.disputes.column.payment'),
        headerText: t('payments.disputes.column.payment'),
        cell: (p) =>
          p.familyId?._id ? (
            <Link
              href={`/families/${p.familyId._id}?tab=payments`}
              className="text-accent hover:underline text-sm"
            >
              {t('payments.disputes.viewPayment')}
            </Link>
          ) : (
            '—'
          ),
      },
      {
        id: 'task',
        header: t('payments.disputes.column.task'),
        headerText: t('payments.disputes.column.task'),
        cell: (p) =>
          p.task ? (
            <Link
              href="/tasks"
              className="text-accent hover:underline text-sm inline-flex items-center gap-1"
            >
              <ClipboardDocumentListIcon className="h-4 w-4" aria-hidden="true" />
              {p.task.title}
            </Link>
          ) : (
            '—'
          ),
      },
    ],
    [t, formatMoney],
  )

  const tabs = [
    { id: 'open' as const, label: t('payments.disputes.filter.open'), count: counts.open },
    { id: 'closed' as const, label: t('payments.disputes.filter.closed'), count: counts.closed },
    { id: 'all' as const, label: t('payments.disputes.filter.all'), count: counts.all },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('payments.disputes.title')}
          subtitle={t('payments.disputes.subtitle')}
        />
        <PaymentsNav />

        <Tabs
          items={tabs.map((tab) => ({
            id: tab.id,
            label: `${tab.label} (${tab.count})`,
          }))}
          activeId={filter}
          onChange={(id) => setFilter(id as DisputeFilter)}
          label={t('payments.disputes.filterLabel')}
          className="mb-4"
        />

        {loading ? (
          <Card>
            <SkeletonRows count={6} />
          </Card>
        ) : error ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title={t('payments.disputes.loadError.title')}
            description={t('payments.disputes.loadError.description')}
            cta={{ label: t('common.retry'), onClick: () => void fetchDisputes() }}
          />
        ) : (
          <DataView
            tableId="payment-disputes"
            rows={items}
            columns={columns}
            rowKey={(p) => p._id}
            sort={sort}
            onSortChange={(id, dir) => setSort({ id, dir })}
            pageSize={15}
            mobileCard={(p) => (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-fg">{p.familyId?.name ?? '—'}</p>
                <p className="text-fg-muted">{formatMoney(p.netAmount)}</p>
              </div>
            )}
            empty={
              <EmptyState
                title={t('payments.disputes.empty.title')}
                description={t('payments.disputes.empty.description')}
              />
            }
          />
        )}
      </div>
    </div>
  )
}
