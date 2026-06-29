'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import { parseDateKey } from '@/lib/date-utils'
import {
  addCalendarDaysToDateKey,
  buildMonthGrid,
  buildWeekDays,
  calendarApiUrl,
  itemsByDateKey,
  monthRangeKeys,
  parseCalendarResponse,
  shiftMonth,
  todayDateKey,
  weekRangeKeys,
  type CalendarItem,
  type CalendarItemKind,
} from '@/lib/client/calendar'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tabs,
} from '@/app/components/ui'
import { cn } from '@/lib/cn'
import type { CalendarItem as ApiCalendarItem } from '@/lib/route-logic/calendar'

type ViewMode = 'month' | 'week'

const WEEKDAY_KEYS: MessageKey[] = [
  'calendar.weekday.sun',
  'calendar.weekday.mon',
  'calendar.weekday.tue',
  'calendar.weekday.wed',
  'calendar.weekday.thu',
  'calendar.weekday.fri',
  'calendar.weekday.sat',
]

const KIND_LABEL_KEYS: Record<CalendarItemKind, MessageKey> = {
  task: 'calendar.kind.task',
  lifecycle_event: 'calendar.kind.lifecycle_event',
  scheduled_email: 'calendar.kind.scheduled_email',
}

const KIND_STYLES: Record<CalendarItemKind, string> = {
  task: 'bg-accent/15 text-accent border-accent/25 hover:bg-accent/25',
  lifecycle_event:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/25',
  scheduled_email:
    'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25 hover:bg-amber-500/25',
}

function formatPeriodLabel(
  view: ViewMode,
  timezone: string,
  anchorYear: number,
  anchorMonth: number,
  weekStartKey: string,
): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'long',
    year: 'numeric',
  })
  if (view === 'month') {
    const utc = new Date(Date.UTC(anchorYear, anchorMonth - 1, 15, 12))
    return fmt.format(utc)
  }
  const start = parseDateKey(weekStartKey)
  const endKey = addCalendarDaysToDateKey(weekStartKey, 6, timezone)
  const end = parseDateKey(endKey)
  if (!start || !end) return ''
  const startDate = new Date(Date.UTC(start.year, start.month - 1, start.day, 12))
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day, 12))
  const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short' })
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric' })
  if (start.year === end.year && start.month === end.month) {
    return `${monthFmt.format(startDate)} ${dayFmt.format(startDate)} – ${dayFmt.format(endDate)}, ${start.year}`
  }
  return `${monthFmt.format(startDate)} ${dayFmt.format(startDate)} – ${monthFmt.format(endDate)} ${dayFmt.format(endDate)}, ${end.year}`
}

function CalendarEventChip({ item }: { item: ApiCalendarItem }) {
  const t = useT()
  return (
    <Link
      href={item.href}
      className={cn(
        'block truncate rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight transition-colors',
        KIND_STYLES[item.kind],
      )}
      title={item.title}
    >
      <span className="sr-only">{t(KIND_LABEL_KEYS[item.kind])}: </span>
      {item.title}
    </Link>
  )
}

function DayCell({
  dateKey,
  day,
  inMonth,
  isToday,
  items,
  tall,
}: {
  dateKey: string
  day: number
  inMonth: boolean
  isToday: boolean
  items: CalendarItem[]
  tall?: boolean
}) {
  return (
    <div
      className={cn(
        'min-h-0 border-b border-e border-border p-1.5',
        tall ? 'min-h-[7.5rem]' : 'min-h-[5.5rem]',
        !inMonth && 'bg-app-subtle/60',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-medium tabular',
            isToday ? 'bg-accent text-accent-fg' : inMonth ? 'text-fg' : 'text-fg-muted',
          )}
        >
          {day}
        </span>
        {items.length > 3 && (
          <span className="text-[10px] text-fg-muted tabular">+{items.length - 3}</span>
        )}
      </div>
      <div className="space-y-0.5">
        {items.slice(0, 3).map((item) => (
          <CalendarEventChip key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </div>
    </div>
  )
}

export default function CalendarView() {
  const t = useT()
  const toast = useToast()
  const { begin, invalidate, isStale } = useRequestGeneration()

  const [view, setView] = useState<ViewMode>('month')
  const [timezone, setTimezone] = useState('UTC')
  const [anchorYear, setAnchorYear] = useState(() => new Date().getFullYear())
  const [anchorMonth, setAnchorMonth] = useState(() => new Date().getMonth() + 1)
  const [weekStartKey, setWeekStartKey] = useState('')
  const [items, setItems] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const todayKey = useMemo(() => todayDateKey(timezone), [timezone])

  useEffect(() => {
    if (!weekStartKey && timezone) {
      const { from } = weekRangeKeys(todayKey, timezone)
      setWeekStartKey(from)
    }
  }, [weekStartKey, timezone, todayKey])

  const range = useMemo(() => {
    if (view === 'month') return monthRangeKeys(anchorYear, anchorMonth)
    if (!weekStartKey) return monthRangeKeys(anchorYear, anchorMonth)
    return weekRangeKeys(weekStartKey, timezone)
  }, [view, anchorYear, anchorMonth, weekStartKey, timezone])

  const fetchCalendar = useCallback(async () => {
    const gen = begin()
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(calendarApiUrl(range.from, range.to))
      if (isStale(gen)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.json().catch(() => null)
      if (isStale(gen)) return
      const parsed = parseCalendarResponse(raw)
      if (!parsed) throw new Error('Invalid response')
      setTimezone(parsed.timezone)
      setItems(parsed.items)
      const parsedToday = parseDateKey(todayDateKey(parsed.timezone))
      if (parsedToday) {
        setAnchorYear(parsedToday.year)
        setAnchorMonth(parsedToday.month)
      }
      if (!weekStartKey) {
        setWeekStartKey(weekRangeKeys(todayDateKey(parsed.timezone), parsed.timezone).from)
      }
    } catch {
      if (isStale(gen)) return
      setItems([])
      setLoadError(true)
      toast.error(t('calendar.error.load'))
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale, range.from, range.to, t, toast, weekStartKey])

  useEffect(() => {
    void fetchCalendar()
  }, [fetchCalendar])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      setWeekStartKey('')
      void fetchCalendar()
    }, [fetchCalendar, invalidate]),
  )

  const grouped = useMemo(() => itemsByDateKey(items), [items])

  const monthGrid = useMemo(
    () => buildMonthGrid(anchorYear, anchorMonth, timezone),
    [anchorYear, anchorMonth, timezone],
  )

  const weekDays = useMemo(() => {
    if (!weekStartKey) return []
    return buildWeekDays(weekStartKey, timezone)
  }, [weekStartKey, timezone])

  const periodLabel = formatPeriodLabel(view, timezone, anchorYear, anchorMonth, weekStartKey)

  const goToday = () => {
    const key = todayDateKey(timezone)
    const parsed = parseDateKey(key)
    if (parsed) {
      setAnchorYear(parsed.year)
      setAnchorMonth(parsed.month)
    }
    setWeekStartKey(weekRangeKeys(key, timezone).from)
  }

  const goPrev = () => {
    if (view === 'month') {
      const next = shiftMonth(anchorYear, anchorMonth, -1)
      setAnchorYear(next.year)
      setAnchorMonth(next.month)
      return
    }
    if (weekStartKey) {
      setWeekStartKey(addCalendarDaysToDateKey(weekStartKey, -7, timezone))
    }
  }

  const goNext = () => {
    if (view === 'month') {
      const next = shiftMonth(anchorYear, anchorMonth, 1)
      setAnchorYear(next.year)
      setAnchorMonth(next.month)
      return
    }
    if (weekStartKey) {
      setWeekStartKey(addCalendarDaysToDateKey(weekStartKey, 7, timezone))
    }
  }

  const gridDays = view === 'month' ? monthGrid : weekDays

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title={t('calendar.title')}
          subtitle={t('calendar.subtitle')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                items={[
                  { id: 'month', label: t('calendar.view.month') },
                  { id: 'week', label: t('calendar.view.week') },
                ]}
                activeId={view}
                onChange={(id) => setView(id as ViewMode)}
                label={t('calendar.view.label')}
              />
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={goPrev}
              aria-label={t('calendar.prev')}
              leftIcon={<ChevronLeftIcon className="h-4 w-4" />}
            />
            <h2 className="min-w-[10rem] text-center text-lg font-semibold text-fg">
              {periodLabel}
            </h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={goNext}
              aria-label={t('calendar.next')}
              leftIcon={<ChevronRightIcon className="h-4 w-4" />}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={goToday}>
              {t('calendar.today')}
            </Button>
            <span className="text-xs text-fg-muted">
              {t('calendar.timezone').replace('{timezone}', timezone)}
            </span>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL_KEYS) as CalendarItemKind[]).map((kind) => (
            <Badge key={kind} variant="muted" className="gap-1.5">
              <span
                className={cn('inline-block h-2 w-2 rounded-full', {
                  'bg-accent': kind === 'task',
                  'bg-emerald-500': kind === 'lifecycle_event',
                  'bg-amber-500': kind === 'scheduled_email',
                })}
                aria-hidden
              />
              {t(KIND_LABEL_KEYS[kind])}
            </Badge>
          ))}
        </div>

        {loading ? (
          <Card>
            <SkeletonRows count={6} />
          </Card>
        ) : loadError ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title={t('calendar.error.title')}
            description={t('calendar.error.description')}
            cta={{
              label: t('common.retry'),
              onClick: () => void fetchCalendar(),
              icon: <ArrowPathIcon className="h-4 w-4" />,
            }}
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="grid grid-cols-7 border-b border-border bg-app-subtle">
              {WEEKDAY_KEYS.map((key) => (
                <div
                  key={key}
                  className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-fg-muted"
                >
                  {t(key)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {gridDays.map((cell) => (
                <DayCell
                  key={cell.dateKey}
                  dateKey={cell.dateKey}
                  day={cell.day}
                  inMonth={view === 'week' ? true : cell.inMonth}
                  isToday={cell.dateKey === todayKey}
                  items={grouped.get(cell.dateKey) ?? []}
                  tall={view === 'week'}
                />
              ))}
            </div>
            {items.length === 0 && (
              <div className="border-t border-border px-4 py-6 text-center text-sm text-fg-muted">
                {t('calendar.empty')}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
