'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  CalendarIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import RecordEventModal from '@/app/components/events/RecordEventModal'
import { formatLocaleDate } from '@/lib/date-utils'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Button,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
  type SortDir,
} from '@/app/components/ui'
import { eventTypeBadgeClass } from '@/lib/event-type-badge'
import { cn } from '@/lib/cn'
import { eventsListUrl, parseEventsListResponse } from '@/lib/client/events-list'
import { sortEventRows } from '@/lib/events/sort-events'
import { useT } from '@/lib/client/i18n'

interface LifecycleEvent {
  _id: string
  familyId: string
  familyName: string
  eventType: string
  eventTypeLabel: string
  eventDate: string
  year: number
  amount: number
  notes: string
}

export interface EventsViewProps {
  initialEvents?: LifecycleEvent[]
  initialNextCursor?: string | null
}

export default function EventsView({
  initialEvents,
  initialNextCursor = null,
}: EventsViewProps = {}) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const serverHydrated = initialEvents !== undefined
  const [events, setEvents] = useState<LifecycleEvent[]>(initialEvents ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [loading, setLoading] = useState(!serverHydrated)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [visibleEvents, setVisibleEvents] = useState<LifecycleEvent[]>(initialEvents ?? [])
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null)
  const [showRecordModal, setShowRecordModal] = useState(false)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchEvents = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean; background?: boolean }) => {
      const gen = begin()
      const append = opts?.append ?? false
      const background = opts?.background ?? false
      try {
        if (append) setLoadingMore(true)
        else if (!background) {
          setLoading(true)
          setLoadError(false)
        }
        const res = await fetch(eventsListUrl(opts?.cursor))
        if (isStale(gen)) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => null)
        if (isStale(gen)) return
        const { items, nextCursor: pageNext } = parseEventsListResponse(data)
        setEvents((prev) =>
          append ? [...prev, ...(items as LifecycleEvent[])] : (items as LifecycleEvent[]),
        )
        if (!append) {
          setVisibleEvents(items as LifecycleEvent[])
        }
        setNextCursor(pageNext)
      } catch {
        if (isStale(gen)) return
        if (!append) {
          setEvents([])
          setNextCursor(null)
          setLoadError(true)
          toast.error(t('events.error.load'))
        } else {
          toast.error(t('events.error.loadMore'))
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
    void fetchEvents({
      background: serverHydrated && (initialEvents?.length ?? 0) > 0,
    })
  }, [fetchEvents, serverHydrated, initialEvents])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      setEvents([])
      setVisibleEvents([])
      setNextCursor(null)
      setLoadError(false)
      setLoading(true)
      void fetchEvents()
    }, [fetchEvents, invalidate]),
  )

  const totalAmount = useMemo(
    () => visibleEvents.reduce((sum, e) => sum + e.amount, 0),
    [visibleEvents],
  )

  const sortedEvents = useMemo(() => sortEventRows(events, sort), [events, sort])

  const eventTypeOptions = useMemo(() => {
    const labels = new Map<string, string>()
    events.forEach((e) => {
      if (e.eventType) labels.set(e.eventType, e.eventTypeLabel || e.eventType)
    })
    return Array.from(labels.entries()).map(([value, label]) => ({ value, label }))
  }, [events])

  const columns: DataColumn<LifecycleEvent>[] = [
    {
      id: 'family',
      header: t('events.column.familyName'),
      headerText: t('events.column.familyName'),
      sortable: true,
      cell: (e) =>
        e.familyId ? (
          <Link
            href={`/families/${e.familyId}`}
            className="font-medium text-accent hover:text-accent-hover hover:underline focus-ring rounded"
          >
            {e.familyName}
          </Link>
        ) : (
          <span className="font-medium text-fg">{e.familyName}</span>
        ),
      exportValue: (e) => e.familyName || '',
      filter: { type: 'select', getValue: (e) => e.familyName || '' },
    },
    {
      id: 'eventType',
      header: t('events.column.eventType'),
      headerText: t('events.column.eventType'),
      sortable: true,
      cell: (e) => (
        <Badge
          size="md"
          className={cn(
            'rounded-full normal-case tracking-normal font-semibold',
            eventTypeBadgeClass(e.eventType),
          )}
        >
          {e.eventTypeLabel}
        </Badge>
      ),
      exportValue: (e) => e.eventTypeLabel || e.eventType || '',
      filter: { type: 'multiselect', getValue: (e) => e.eventType, options: eventTypeOptions },
    },
    {
      id: 'eventDate',
      header: t('events.column.eventDate'),
      headerText: t('events.column.eventDate'),
      sortable: true,
      cell: (e) => <span className="tabular">{formatLocaleDate(e.eventDate)}</span>,
      exportValue: (e) => (e.eventDate ? new Date(e.eventDate) : ''),
      filter: { type: 'dateRange', getValue: (e) => e.eventDate || null },
    },
    {
      id: 'year',
      header: t('events.column.year'),
      headerText: t('events.column.year'),
      hideBelow: 'md',
      sortable: true,
      cell: (e) => <span className="text-fg-muted tabular">{e.year}</span>,
      exportValue: (e) => e.year || '',
      filter: { type: 'select', getValue: (e) => (e.year ? String(e.year) : '') },
    },
    {
      id: 'amount',
      header: t('events.column.amount'),
      headerText: t('events.column.amount'),
      align: 'right',
      sortable: true,
      cell: (e) => (
        <span className="font-medium tabular">
          {Number.isFinite(e.amount) ? formatMoney(e.amount) : '—'}
        </span>
      ),
      exportValue: (e) => e.amount || 0,
      filter: { type: 'numberRange', getValue: (e) => e.amount || 0 },
    },
    {
      id: 'notes',
      header: t('events.column.notes'),
      headerText: t('events.column.notes'),
      hideBelow: 'lg',
      defaultHidden: true,
      sortable: true,
      cell: (e) => <span className="text-fg-muted text-sm">{e.notes || '—'}</span>,
      exportValue: (e) => e.notes || '',
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('events.title')}
          subtitle={t('events.subtitle')}
          actions={
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <Button
                leftIcon={<PlusIcon className="h-5 w-5" />}
                onClick={() => setShowRecordModal(true)}
              >
                {t('events.addEvent')}
              </Button>
              <div className="text-right">
                <div className="text-xs text-fg-muted">{t('events.totalAmount')}</div>
                <div className="text-2xl sm:text-3xl font-bold text-fg tabular">
                  {formatMoney(totalAmount)}
                </div>
              </div>
            </div>
          }
        />

        {loading ? (
          <Card>
            <SkeletonRows count={8} />
          </Card>
        ) : loadError ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title={t('events.loadError.title')}
            description={t('events.loadError.description')}
            cta={{
              label: t('common.retry'),
              onClick: () => fetchEvents(),
              icon: <ArrowPathIcon className="h-4 w-4" />,
            }}
          />
        ) : (
          <DataView
            tableId="events"
            rows={sortedEvents}
            columns={columns}
            rowKey={(e) => e._id}
            sort={sort}
            onSortChange={(id, dir) => setSort({ id, dir })}
            globalSearch={{ placeholder: t('events.searchPlaceholder') }}
            pageSize={10}
            import={{ type: 'lifecycle-events', onImported: () => fetchEvents({}) }}
            onFilteredRowsChange={setVisibleEvents}
            mobileCard={(e) => <EventMobileCard event={e} />}
            empty={
              <EmptyState
                icon={<CalendarIcon className="h-10 w-10" />}
                title={t('events.empty.title')}
                description={t('events.empty.description')}
                cta={{
                  label: t('events.empty.cta'),
                  onClick: () => setShowRecordModal(true),
                  icon: <PlusIcon className="h-4 w-4" />,
                }}
              />
            }
          />
        )}

        {!loading && !loadError && nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={loadingMore}
              onClick={() => fetchEvents({ cursor: nextCursor, append: true })}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        )}
      </div>

      <RecordEventModal
        open={showRecordModal}
        onClose={() => setShowRecordModal(false)}
        onCreated={() => fetchEvents({})}
      />
    </div>
  )
}

function EventMobileCard({ event }: { event: LifecycleEvent }) {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  return (
    <Card compact>
      <div className="flex items-start justify-between gap-3">
        {event.familyId ? (
          <Link
            href={`/families/${event.familyId}`}
            className="font-semibold text-accent hover:underline focus-ring rounded"
          >
            {event.familyName}
          </Link>
        ) : (
          <span className="font-semibold text-fg">{event.familyName}</span>
        )}
        <span className="font-medium tabular text-fg">
          {Number.isFinite(event.amount) ? formatMoney(event.amount) : '—'}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
        <div>
          <dt className="text-fg-muted">{t('events.mobile.type')}</dt>
          <dd>
            <Badge
              size="md"
              className={cn(
                'rounded-full normal-case tracking-normal font-semibold',
                eventTypeBadgeClass(event.eventType),
              )}
            >
              {event.eventTypeLabel}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t('events.mobile.date')}</dt>
          <dd className="tabular">{formatLocaleDate(event.eventDate)}</dd>
        </div>
        {event.notes && (
          <div className="col-span-2">
            <dt className="text-fg-muted">{t('common.notes')}</dt>
            <dd>{event.notes}</dd>
          </div>
        )}
      </dl>
    </Card>
  )
}
