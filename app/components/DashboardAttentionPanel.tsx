'use client'

import { useState, useEffect, useCallback, useRef, Children } from 'react'
import Link from 'next/link'
import {
  ExclamationTriangleIcon,
  ClockIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  BanknotesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { formatLocaleDate } from '@/lib/date-utils'
import { useT } from '@/lib/client/i18n'
import {
  isAttentionItemHidden,
  snoozeAttentionForDays,
  type AttentionItemKey,
} from '@/lib/client/attention-snooze'
import { Skeleton } from './ui/Skeleton'
import type { DashboardAttentionPayload } from '@/lib/route-logic/dashboard-actions'

export interface DashboardAttentionPanelProps {
  initialAttention?: DashboardAttentionPayload | null
}

const DELINQUENT_SNOOZE_KEY: AttentionItemKey = 'delinquentFamilies'

const EMPTY_ATTENTION: DashboardAttentionPayload = {
  overdueTasks: { count: 0, items: [] },
  dueTodayTasks: { count: 0, items: [] },
  upcomingEvents: { count: 0, items: [] },
  recentPayments: [],
  delinquentFamilies: { count: 0, items: [], aging: null },
  emailSummary: { failedLast7Days: 0, lastSentAt: null, pendingScheduled: 0 },
}

export default function DashboardAttentionPanel({
  initialAttention = null,
}: DashboardAttentionPanelProps) {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const hasInitial = initialAttention !== null
  const [attention, setAttention] = useState<DashboardAttentionPayload>(
    initialAttention ?? EMPTY_ATTENTION,
  )
  const [loading, setLoading] = useState(!hasInitial)
  const [error, setError] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [delinquentHidden, setDelinquentHidden] = useState(false)
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false)
  const hasFetchedRef = useRef(hasInitial)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const refreshDelinquentHidden = useCallback((activeOrgId: string | null) => {
    if (!activeOrgId) {
      setDelinquentHidden(false)
      return
    }
    setDelinquentHidden(isAttentionItemHidden(activeOrgId, DELINQUENT_SNOOZE_KEY))
  }, [])

  const fetchOrgId = useCallback(async () => {
    try {
      const data = await cachedFetch<{
        activeOrgId?: string | null
        organizations?: { id: string }[]
      }>('/api/organizations', { ttl: 60_000 })
      const id = data.activeOrgId ?? data.organizations?.[0]?.id ?? null
      setOrgId(id)
      refreshDelinquentHidden(id)
    } catch {
      setOrgId(null)
      setDelinquentHidden(false)
    }
  }, [refreshDelinquentHidden])

  const fetchAttention = useCallback(async () => {
    const gen = begin()
    setError(false)
    try {
      const data = await cachedFetch<DashboardAttentionPayload>('/api/dashboard-actions', {
        ttl: 30_000,
      })
      if (isStale(gen)) return
      setAttention(data)
    } catch {
      if (isStale(gen)) return
      setError(true)
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale])

  useEffect(() => {
    void fetchOrgId()
  }, [fetchOrgId])

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    fetchAttention()
  }, [fetchAttention])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      hasFetchedRef.current = false
      setLoading(true)
      void fetchOrgId()
      fetchAttention()
    }, [fetchAttention, fetchOrgId, invalidate]),
  )

  const handleSnoozeDelinquent = (days: number) => {
    if (!orgId) return
    snoozeAttentionForDays(orgId, DELINQUENT_SNOOZE_KEY, days)
    setDelinquentHidden(true)
    setSnoozeMenuOpen(false)
  }

  if (loading) {
    return (
      <section className="mb-8" aria-labelledby="dashboard-attention-title" aria-busy="true">
        <h2 id="dashboard-attention-title" className="sr-only">
          {t('dashboard.attention.title')}
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="surface-card p-5">
              <Skeleton h={16} w="45%" />
              <div className="mt-4 space-y-3">
                <Skeleton h={14} w="90%" />
                <Skeleton h={14} w="75%" />
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="mb-8 surface-card p-5" aria-labelledby="dashboard-attention-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dashboard-attention-title" className="text-base font-semibold text-fg">
            {t('dashboard.attention.title')}
          </h2>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              fetchAttention()
            }}
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
          >
            <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
            {t('common.retry')}
          </button>
        </div>
        <p className="mt-2 text-sm text-fg-muted">{t('dashboard.attention.loadError')}</p>
      </section>
    )
  }

  const aging = attention.delinquentFamilies.aging
  const agingSummary =
    aging &&
    [
      aging.days30 > 0
        ? t('dashboard.attention.agingSummary30').replace('{count}', String(aging.days30))
        : null,
      aging.days60 > 0
        ? t('dashboard.attention.agingSummary60').replace('{count}', String(aging.days60))
        : null,
      aging.days90 > 0
        ? t('dashboard.attention.agingSummary90').replace('{count}', String(aging.days90))
        : null,
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <section className="mb-8" aria-labelledby="dashboard-attention-title">
      <h2 id="dashboard-attention-title" className="text-base font-semibold text-fg mb-4">
        {t('dashboard.attention.title')}
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {!delinquentHidden && (
          <AttentionCard
            title={t('dashboard.attention.delinquentFamilies')}
            count={attention.delinquentFamilies.count}
            href="/collections"
            icon={BanknotesIcon}
            iconClassName="text-danger"
            emptyLabel={t('dashboard.attention.noDelinquentFamilies')}
            footer={agingSummary || undefined}
            headerAction={
              attention.delinquentFamilies.count > 0 ? (
                <AttentionSnoozeMenu
                  open={snoozeMenuOpen}
                  onOpenChange={setSnoozeMenuOpen}
                  onSnooze={handleSnoozeDelinquent}
                />
              ) : undefined
            }
          >
            {attention.delinquentFamilies.items.map((family) => (
              <AttentionRow
                key={family.familyId}
                href={`/families/${family.familyId}`}
                primary={family.familyName}
                secondary={
                  family.lastPaymentDate
                    ? t('dashboard.attention.lastPayment').replace(
                        '{date}',
                        formatLocaleDate(family.lastPaymentDate),
                      )
                    : t('dashboard.attention.noLastPayment')
                }
                trailing={formatMoney(-family.amountOwed)}
                badge={
                  family.daysOverdue != null && family.daysOverdue >= 30
                    ? t('dashboard.attention.daysOverdueBadge').replace(
                        '{days}',
                        String(family.daysOverdue),
                      )
                    : undefined
                }
                badgeClassName="text-danger bg-danger/10"
              />
            ))}
          </AttentionCard>
        )}

        <AttentionCard
          title={t('dashboard.attention.overdueTasks')}
          count={attention.overdueTasks.count}
          href="/tasks?dueDate=overdue"
          icon={ExclamationTriangleIcon}
          iconClassName="text-danger"
          emptyLabel={t('dashboard.attention.noOverdue')}
        >
          {attention.overdueTasks.items.map((task) => (
            <AttentionRow
              key={task._id}
              primary={task.title}
              secondary={formatLocaleDate(task.dueDate)}
              badge={t('dashboard.overdueBadge')}
              badgeClassName="text-danger bg-danger/10"
            />
          ))}
        </AttentionCard>

        <AttentionCard
          title={t('dashboard.attention.dueToday')}
          count={attention.dueTodayTasks.count}
          href="/tasks?dueDate=today"
          icon={ClockIcon}
          iconClassName="text-warning"
          emptyLabel={t('dashboard.attention.noDueToday')}
        >
          {attention.dueTodayTasks.items.map((task) => (
            <AttentionRow
              key={task._id}
              primary={task.title}
              secondary={formatLocaleDate(task.dueDate)}
            />
          ))}
        </AttentionCard>

        <AttentionCard
          title={t('dashboard.attention.upcomingEvents')}
          count={attention.upcomingEvents.count}
          href="/events"
          icon={CalendarDaysIcon}
          emptyLabel={t('dashboard.attention.noUpcomingEvents')}
        >
          {attention.upcomingEvents.items.map((event) => (
            <AttentionRow
              key={event._id}
              primary={event.familyName}
              secondary={`${event.eventTypeLabel} · ${formatLocaleDate(event.eventDate)}`}
              trailing={formatMoney(event.amount)}
            />
          ))}
        </AttentionCard>

        <AttentionCard
          title={t('dashboard.attention.recentPayments')}
          count={attention.recentPayments.length}
          href="/payments"
          icon={CurrencyDollarIcon}
          emptyLabel={t('dashboard.attention.noRecentPayments')}
          hideMore
        >
          {attention.recentPayments.map((payment) => (
            <AttentionRow
              key={payment._id}
              primary={payment.familyName}
              secondary={formatLocaleDate(payment.paymentDate)}
              trailing={formatMoney(payment.amount)}
            />
          ))}
        </AttentionCard>
      </div>
    </section>
  )
}

function AttentionSnoozeMenu({
  open,
  onOpenChange,
  onSnooze,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSnooze: (days: number) => void
}) {
  const t = useT()

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="focus-ring p-1 rounded-md text-fg-muted hover:text-fg hover:bg-fg/5"
        aria-label={t('dashboard.attention.snoozeMenuAria')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-label={t('common.close')}
            onClick={() => onOpenChange(false)}
          />
          <div
            role="menu"
            className="absolute end-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-surface shadow-lg py-1 text-sm"
          >
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                role="menuitem"
                className="focus-ring w-full px-3 py-2 text-start text-fg hover:bg-fg/5"
                onClick={() => onSnooze(days)}
              >
                {t('dashboard.attention.snoozeDays').replace('{days}', String(days))}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AttentionCard({
  title,
  count,
  href,
  icon: Icon,
  iconClassName = 'text-fg-muted',
  emptyLabel,
  hideMore = false,
  footer,
  headerAction,
  children,
}: {
  title: string
  count: number
  href: string
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  emptyLabel: string
  hideMore?: boolean
  footer?: string
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  const t = useT()
  const childCount = Children.count(children)
  const showMore = !hideMore && count > childCount

  return (
    <div className="surface-card p-5 flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-fg/5 rounded-md shrink-0">
            <Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-fg truncate">{title}</h3>
          {count > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-fg/10 text-xs font-semibold text-fg-muted tabular">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerAction}
          <Link
            href={href}
            className="focus-ring inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:text-accent-hover"
          >
            {t('dashboard.viewAll')}
            <ChevronRightIcon className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
      {childCount === 0 ? (
        <p className="text-sm text-fg-muted py-2">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border -mx-1">{children}</ul>
      )}
      {footer && <p className="mt-3 text-xs text-fg-muted">{footer}</p>}
      {showMore && (
        <p className="mt-3 text-xs text-fg-muted">
          {t('dashboard.attention.moreCount').replace('{count}', String(count - childCount))}
        </p>
      )}
    </div>
  )
}

function AttentionRow({
  primary,
  secondary,
  trailing,
  badge,
  badgeClassName,
  href,
}: {
  primary: string
  secondary?: string
  trailing?: string
  badge?: string
  badgeClassName?: string
  href?: string
}) {
  const inner = (
    <>
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${href ? 'text-accent' : 'text-fg'}`}>{primary}</p>
        {secondary && <p className="text-xs text-fg-muted truncate mt-0.5">{secondary}</p>}
      </div>
      {badge && (
        <span
          className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${badgeClassName ?? ''}`}
        >
          {badge}
        </span>
      )}
      {trailing && (
        <span className="shrink-0 text-fg-muted tabular text-xs font-medium">{trailing}</span>
      )}
    </>
  )

  return (
    <li className="px-1 py-2.5 flex items-start gap-2 text-sm">
      {href ? (
        <Link href={href} className="focus-ring flex flex-1 items-start gap-2 rounded min-w-0">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  )
}
