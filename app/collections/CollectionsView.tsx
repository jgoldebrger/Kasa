'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BanknotesIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { formatLocaleDate } from '@/lib/date-utils'
import { useT } from '@/lib/client/i18n'
import {
  Badge,
  DataView,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  type DataColumn,
  type SortDir,
} from '@/app/components/ui'
import type { DelinquencyAgingBuckets, DelinquentFamilyRow } from '@/lib/route-logic/collections'

type AgingFilter = 'all' | '30' | '60' | '90'

interface CollectionsPayload {
  count: number
  items: DelinquentFamilyRow[]
  aging: DelinquencyAgingBuckets | null
  agingFilter: AgingFilter
}

export interface CollectionsViewProps {
  initialData?: {
    count: number
    items: DelinquentFamilyRow[]
    aging: DelinquencyAgingBuckets | null
  }
  initialAging?: AgingFilter
}

export default function CollectionsView({
  initialData,
  initialAging = 'all',
}: CollectionsViewProps = {}) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { format: formatMoney } = useCurrency()
  const serverHydrated = initialData !== undefined
  const [agingFilter, setAgingFilter] = useState<AgingFilter>(initialAging)
  const [allItems, setAllItems] = useState<DelinquentFamilyRow[]>(initialData?.items ?? [])
  const [totalCount, setTotalCount] = useState(initialData?.count ?? 0)
  const [aging, setAging] = useState<DelinquencyAgingBuckets | null>(initialData?.aging ?? null)
  const [loading, setLoading] = useState(!serverHydrated)
  const [error, setError] = useState(false)
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>({
    id: 'amountOwed',
    dir: 'desc',
  })
  const hasFetchedRef = useRef(serverHydrated)
  const { begin, invalidate, isStale } = useRequestGeneration()

  useEffect(() => {
    const fromUrl = searchParams.get('aging')
    if (fromUrl === '30' || fromUrl === '60' || fromUrl === '90') {
      setAgingFilter(fromUrl)
    } else if (fromUrl === 'all' || fromUrl === null) {
      setAgingFilter('all')
    }
  }, [searchParams])

  const fetchCollections = useCallback(async () => {
    const gen = begin()
    setError(false)
    try {
      const qs = agingFilter !== 'all' ? `?aging=${agingFilter}` : ''
      const data = await cachedFetch<CollectionsPayload>(`/api/collections${qs}`, {
        ttl: 30_000,
      })
      if (isStale(gen)) return
      setAllItems(data.items)
      setTotalCount(data.count)
      setAging(data.aging)
    } catch {
      if (isStale(gen)) return
      setError(true)
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [agingFilter, begin, isStale])

  const prevAgingRef = useRef(agingFilter)

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    if (!serverHydrated) fetchCollections()
  }, [fetchCollections, serverHydrated])

  useEffect(() => {
    if (prevAgingRef.current === agingFilter) return
    prevAgingRef.current = agingFilter
    if (!hasFetchedRef.current) return
    setLoading(true)
    fetchCollections()
  }, [agingFilter, fetchCollections])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      hasFetchedRef.current = false
      setLoading(true)
      fetchCollections()
    }, [fetchCollections, invalidate]),
  )

  const handleAgingChange = (value: string) => {
    const next = (value === '30' || value === '60' || value === '90' ? value : 'all') as AgingFilter
    setAgingFilter(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'all') params.delete('aging')
    else params.set('aging', next)
    const qs = params.toString()
    router.replace(qs ? `/collections?${qs}` : '/collections', { scroll: false })
  }

  const visibleItems = useMemo(() => {
    let rows = [...allItems]
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1
      rows.sort((a, b) => {
        switch (sort.id) {
          case 'familyName':
            return dir * a.familyName.localeCompare(b.familyName)
          case 'balance':
            return dir * (a.balance - b.balance)
          case 'amountOwed':
            return dir * (a.amountOwed - b.amountOwed)
          case 'lastPaymentDate': {
            const aT = a.lastPaymentDate ? new Date(a.lastPaymentDate).getTime() : 0
            const bT = b.lastPaymentDate ? new Date(b.lastPaymentDate).getTime() : 0
            return dir * (aT - bT)
          }
          case 'daysOverdue':
            return dir * ((a.daysOverdue ?? -1) - (b.daysOverdue ?? -1))
          default:
            return 0
        }
      })
    }
    return rows
  }, [allItems, sort])

  const columns: DataColumn<DelinquentFamilyRow>[] = useMemo(
    () => [
      {
        id: 'familyName',
        header: t('collections.col.family'),
        headerText: t('collections.col.family'),
        sortable: true,
        cell: (row) => (
          <Link
            href={`/families/${row.familyId}`}
            className="font-medium text-accent hover:text-accent-hover focus-ring rounded"
          >
            {row.familyName}
          </Link>
        ),
        exportValue: (row) => row.familyName,
        filter: { type: 'text', getValue: (row) => row.familyName },
      },
      {
        id: 'balance',
        header: t('collections.col.balance'),
        headerText: t('collections.col.balance'),
        sortable: true,
        cell: (row) => (
          <span className="tabular font-medium text-danger">{formatMoney(row.balance)}</span>
        ),
        exportValue: (row) => row.balance,
        filter: { type: 'numberRange', getValue: (row) => row.balance },
      },
      {
        id: 'lastPaymentDate',
        header: t('collections.col.lastPayment'),
        headerText: t('collections.col.lastPayment'),
        sortable: true,
        cell: (row) => (
          <span className="text-fg-muted tabular">
            {row.lastPaymentDate
              ? formatLocaleDate(row.lastPaymentDate)
              : t('collections.noPayment')}
          </span>
        ),
        exportValue: (row) =>
          row.lastPaymentDate ? formatLocaleDate(row.lastPaymentDate) : t('collections.noPayment'),
        filter: {
          type: 'dateRange',
          getValue: (row) => (row.lastPaymentDate ? String(row.lastPaymentDate) : null),
        },
      },
      {
        id: 'daysOverdue',
        header: t('collections.col.daysOverdue'),
        headerText: t('collections.col.daysOverdue'),
        sortable: true,
        cell: (row) => {
          if (row.daysOverdue == null) {
            return <span className="text-fg-muted">—</span>
          }
          const bucket =
            row.daysOverdue >= 90
              ? '90'
              : row.daysOverdue >= 60
                ? '60'
                : row.daysOverdue >= 30
                  ? '30'
                  : null
          return (
            <span className="inline-flex items-center gap-2">
              <span className="tabular">{row.daysOverdue}</span>
              {bucket && (
                <Badge variant={bucket === '90' ? 'danger' : bucket === '60' ? 'warning' : 'muted'}>
                  {t(`collections.aging.${bucket}` as 'collections.aging.30')}
                </Badge>
              )}
            </span>
          )
        },
        exportValue: (row) => row.daysOverdue ?? '',
        filter: { type: 'numberRange', getValue: (row) => row.daysOverdue ?? -1 },
      },
    ],
    [formatMoney, t],
  )

  const agingOptions = [
    { value: 'all', label: t('collections.filter.all') },
    { value: '30', label: t('collections.filter.days30') },
    { value: '60', label: t('collections.filter.days60') },
    { value: '90', label: t('collections.filter.days90') },
  ]

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader title={t('collections.title')} subtitle={t('collections.subtitle')} />

      {aging && (
        <div className="mb-6 flex flex-wrap gap-3">
          <AgingStat
            label={t('collections.aging.days30')}
            count={aging.days30}
            href="/collections?aging=30"
            active={agingFilter === '30'}
          />
          <AgingStat
            label={t('collections.aging.days60')}
            count={aging.days60}
            href="/collections?aging=60"
            active={agingFilter === '60'}
          />
          <AgingStat
            label={t('collections.aging.days90')}
            count={aging.days90}
            href="/collections?aging=90"
            active={agingFilter === '90'}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          label={t('collections.filter.label')}
          value={agingFilter}
          onChange={(e) => handleAgingChange(e.target.value)}
          wrapperClassName="w-auto min-w-[10rem]"
        >
          {agingOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <p className="text-sm text-fg-muted">
          {t('collections.summaryCount')
            .replace('{shown}', String(visibleItems.length))
            .replace('{total}', String(totalCount))}
        </p>
      </div>

      {loading ? (
        <SkeletonRows count={8} />
      ) : error ? (
        <div className="surface-card p-6 text-center">
          <ExclamationTriangleIcon
            className="mx-auto h-8 w-8 text-danger mb-3"
            aria-hidden="true"
          />
          <p className="text-sm text-fg-muted mb-4">{t('collections.loadError')}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              fetchCollections()
            }}
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
          >
            <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
            {t('common.retry')}
          </button>
        </div>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={<BanknotesIcon className="h-10 w-10 text-fg-muted" aria-hidden="true" />}
          title={t('collections.empty.title')}
          description={t('collections.empty.description')}
          cta={null}
        />
      ) : (
        <DataView
          tableId="collections"
          rows={visibleItems}
          columns={columns}
          rowKey={(row) => row.familyId}
          sort={sort}
          onSortChange={(id, dir) => setSort({ id, dir })}
          globalSearch={{
            placeholder: t('collections.searchPlaceholder'),
            getValue: (row) => row.familyName,
          }}
          exportFileName="collections"
          pageSize={25}
          mobileCard={(row) => (
            <div className="surface-card p-4">
              <Link
                href={`/families/${row.familyId}`}
                className="font-semibold text-accent hover:underline focus-ring rounded"
              >
                {row.familyName}
              </Link>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-fg-muted">{t('collections.col.balance')}</p>
                  <p className="font-medium text-danger tabular">{formatMoney(row.balance)}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-muted">{t('collections.col.daysOverdue')}</p>
                  <p className="font-medium tabular">{row.daysOverdue ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-fg-muted">{t('collections.col.lastPayment')}</p>
                  <p className="text-fg-muted tabular">
                    {row.lastPaymentDate
                      ? formatLocaleDate(row.lastPaymentDate)
                      : t('collections.noPayment')}
                  </p>
                </div>
              </div>
            </div>
          )}
        />
      )}
    </div>
  )
}

function AgingStat({
  label,
  count,
  href,
  active,
}: {
  label: string
  count: number
  href: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`surface-card px-4 py-3 min-w-[7rem] transition-colors focus-ring rounded-lg ${
        active ? 'ring-2 ring-accent bg-accent/5' : 'hover:bg-fg/[0.02]'
      }`}
    >
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="text-2xl font-semibold tabular text-fg mt-0.5">{count}</p>
    </Link>
  )
}
