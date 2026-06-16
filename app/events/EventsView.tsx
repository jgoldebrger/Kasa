'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { CalendarIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { formatLocaleDate } from '@/lib/date-utils'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { useToast } from '@/app/components/Toast'
import {
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'

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

// Deterministic badge palette keyed off the raw eventType string. Each
// slot must be a literal class string so Tailwind's purge keeps it. The
// hash is stable across reloads so users see consistent colors per type
// without us hardcoding which event gets which color.
const EVENT_BADGE_PALETTE = [
  'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
  'bg-accent/10 text-accent',
  'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
] as const
function eventTypeBadgeClass(eventType: string): string {
  if (!eventType) return EVENT_BADGE_PALETTE[0]
  let hash = 0
  for (let i = 0; i < eventType.length; i++) {
    hash = (hash * 31 + eventType.charCodeAt(i)) | 0
  }
  return EVENT_BADGE_PALETTE[Math.abs(hash) % EVENT_BADGE_PALETTE.length]
}

export interface EventsViewProps {
  initialEvents?: LifecycleEvent[]
}

export default function EventsView({ initialEvents }: EventsViewProps = {}) {
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  const serverHydrated = initialEvents !== undefined
  const [events, setEvents] = useState<LifecycleEvent[]>(initialEvents ?? [])
  const [loading, setLoading] = useState(!serverHydrated)
  const [loadError, setLoadError] = useState(false)
  const [visibleEvents, setVisibleEvents] = useState<LifecycleEvent[]>([])
  const hasFetchedRef = useRef(serverHydrated)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchEvents = useCallback(async () => {
    const gen = begin()
    try {
      setLoading(true)
      setLoadError(false)
      const res = await fetch('/api/events')
      if (isStale(gen)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => [])
      if (isStale(gen)) return
      setEvents(Array.isArray(data) ? data : [])
    } catch {
      if (isStale(gen)) return
      setLoadError(true)
      toast.error('Could not load events.')
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [toast, begin, isStale])

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    let cancelled = false
    void fetchEvents().finally(() => {
      if (cancelled) setEvents([])
    })
    return () => {
      cancelled = true
    }
  }, [fetchEvents])

  useOrgChanged(useCallback(() => {
    invalidate()
    hasFetchedRef.current = false
    setEvents([])
    setLoadError(false)
    fetchEvents()
  }, [fetchEvents, invalidate]))

  const totalAmount = useMemo(
    () => visibleEvents.reduce((sum, e) => sum + e.amount, 0),
    [visibleEvents],
  )

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
      header: 'Family Name',
      headerText: 'Family Name',
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
      header: 'Event Type',
      headerText: 'Event Type',
      cell: (e) => (
        <span
          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${eventTypeBadgeClass(e.eventType)}`}
        >
          {e.eventTypeLabel}
        </span>
      ),
      exportValue: (e) => e.eventTypeLabel || e.eventType || '',
      filter: { type: 'multiselect', getValue: (e) => e.eventType, options: eventTypeOptions },
    },
    {
      id: 'eventDate',
      header: 'Event Date',
      headerText: 'Event Date',
      cell: (e) => <span className="tabular">{formatLocaleDate(e.eventDate)}</span>,
      exportValue: (e) => (e.eventDate ? new Date(e.eventDate) : ''),
      filter: { type: 'dateRange', getValue: (e) => e.eventDate || null },
    },
    {
      id: 'year',
      header: 'Year',
      headerText: 'Year',
      hideBelow: 'md',
      cell: (e) => <span className="text-fg-muted tabular">{e.year}</span>,
      exportValue: (e) => e.year || '',
      filter: { type: 'select', getValue: (e) => (e.year ? String(e.year) : '') },
    },
    {
      id: 'amount',
      header: 'Amount',
      headerText: 'Amount',
      align: 'right',
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
      header: 'Notes',
      headerText: 'Notes',
      hideBelow: 'lg',
      defaultHidden: true,
      cell: (e) => <span className="text-fg-muted text-sm">{e.notes || '—'}</span>,
      exportValue: (e) => e.notes || '',
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="All Lifecycle Events"
          subtitle="Every lifecycle event recorded across the organization."
          actions={
            <div className="text-right">
              <div className="text-xs text-fg-muted">Total Amount</div>
              <div className="text-2xl sm:text-3xl font-bold text-fg tabular">
                {formatMoney(totalAmount)}
              </div>
            </div>
          }
        />

        {loading ? (
          <div className="surface-card p-6">
            <SkeletonRows count={8} />
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Couldn't load events"
            description="Check your connection and try again."
            cta={{
              label: 'Retry',
              onClick: () => fetchEvents(),
              icon: <ArrowPathIcon className="h-4 w-4" />,
            }}
          />
        ) : (
          <DataView
            tableId="events"
            rows={events}
            columns={columns}
            rowKey={(e) => e._id}
            globalSearch={{ placeholder: 'Search family, type, notes…' }}
            pageSize={10}
            import={{ type: 'lifecycle-events', onImported: () => fetchEvents() }}
            onFilteredRowsChange={setVisibleEvents}
            mobileCard={(e) => <EventMobileCard event={e} />}
            empty={
              <EmptyState
                icon={<CalendarIcon className="h-10 w-10" />}
                title="No events"
                description="Nothing recorded yet."
              />
            }
          />
        )}
      </div>
    </div>
  )
}

function EventMobileCard({ event }: { event: LifecycleEvent }) {
  const { format: formatMoney } = useCurrency()
  return (
    <div className="surface-card p-4">
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
          <dt className="text-fg-muted">Type</dt>
          <dd>{event.eventTypeLabel}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Date</dt>
          <dd className="tabular">{formatLocaleDate(event.eventDate)}</dd>
        </div>
        {event.notes && (
          <div className="col-span-2">
            <dt className="text-fg-muted">Notes</dt>
            <dd>{event.notes}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}
