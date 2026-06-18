'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChartBarIcon,
  ChartBarSquareIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BoltIcon,
  DocumentTextIcon,
  CalculatorIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { useToast } from './components/Toast'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { useT } from '@/lib/client/i18n'
import { EmptyState, PageHeader, Tooltip } from './components/ui'
import { Skeleton } from './components/ui/Skeleton'
import OnboardingChecklist from './components/OnboardingChecklist'

interface DashboardStats {
  totalFamilies: number
  totalMembers: number
  totalIncome: number
  totalExpenses: number
  balance: number
}

export interface DashboardViewProps {
  initialStats?: DashboardStats
  /** False when server could not resolve balance/income (no cached yearly calc). */
  initialFinancialsComplete?: boolean
  /** Server-prefetched onboarding checklist (admin dashboard). */
  initialSetupProgress?:
    | import('@/lib/organizations/setup-progress-data').SetupProgressPayload
    | null
  /** When false, hide org-wide balance/income and admin quick actions. */
  showFinancials?: boolean
}

export default function DashboardView({
  initialStats,
  initialFinancialsComplete = true,
  initialSetupProgress = null,
  showFinancials = true,
}: DashboardViewProps = {}) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const hasInitialStats = initialStats !== undefined
  const needsFinancialCompute = showFinancials && !initialFinancialsComplete
  const [stats, setStats] = useState<DashboardStats>(
    initialStats ?? {
      totalFamilies: 0,
      totalMembers: 0,
      totalIncome: 0,
      totalExpenses: 0,
      balance: 0,
    },
  )
  const [loadingCounts, setLoadingCounts] = useState(!hasInitialStats)
  const [loadingFinancials, setLoadingFinancials] = useState(needsFinancialCompute)
  const [statsError, setStatsError] = useState(false)
  const hasFetchedStatsRef = useRef(hasInitialStats && !needsFinancialCompute)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchDashboardData = useCallback(
    async (compute = false) => {
      const gen = begin()
      setStatsError(false)
      try {
        const url = compute ? '/api/dashboard-stats?compute=1' : '/api/dashboard-stats'
        const data = await cachedFetch<{
          totalFamilies: number
          totalMembers: number
          calculatedIncome: number
          calculatedExpenses: number
          balance: number
          financialsPending?: boolean
        }>(url, { ttl: 30_000 })
        if (isStale(gen)) return

        setStats({
          totalFamilies: data.totalFamilies || 0,
          totalMembers: data.totalMembers || 0,
          totalIncome: showFinancials ? data.calculatedIncome || 0 : 0,
          totalExpenses: showFinancials ? data.calculatedExpenses || 0 : 0,
          balance: showFinancials ? data.balance || 0 : 0,
        })
      } catch {
        if (isStale(gen)) return
        setStatsError(true)
        toast.error(t('dashboard.error.loadStats'))
      } finally {
        if (!isStale(gen)) {
          setLoadingCounts(false)
          setLoadingFinancials(false)
        }
      }
    },
    [toast, showFinancials, begin, isStale, t],
  )

  useEffect(() => {
    if (hasFetchedStatsRef.current) return
    hasFetchedStatsRef.current = true
    fetchDashboardData(needsFinancialCompute || !hasInitialStats)
  }, [fetchDashboardData, needsFinancialCompute, hasInitialStats])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      hasFetchedStatsRef.current = false
      setLoadingCounts(true)
      setLoadingFinancials(showFinancials)
      fetchDashboardData(showFinancials)
    }, [fetchDashboardData, showFinancials, invalidate]),
  )

  const loadingStats = loadingCounts || (showFinancials && loadingFinancials)

  return (
    <div className="min-h-screen bg-app p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

        {showFinancials && <OnboardingChecklist initialProgress={initialSetupProgress} />}
        {!showFinancials && <MemberWelcomeChecklist />}

        {statsError && !loadingStats ? (
          <div className="mb-8">
            <EmptyState
              icon={<ExclamationTriangleIcon />}
              title={t('dashboard.statsLoadError')}
              description={t('dashboard.statsLoadErrorDesc')}
              cta={{
                label: t('common.retry'),
                onClick: () => fetchDashboardData(showFinancials),
                icon: <ArrowPathIcon className="h-4 w-4" />,
              }}
            />
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 mb-8 ${
              showFinancials ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
            }`}
          >
            {showFinancials &&
              (loadingFinancials ? (
                <>
                  <div className="sm:col-span-2 lg:col-span-3 surface-card p-6">
                    <Skeleton h={14} w="30%" />
                    <div className="mt-3">
                      <Skeleton h={44} w="55%" />
                    </div>
                  </div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="surface-card p-5">
                      <Skeleton h={14} w="50%" />
                      <div className="mt-3">
                        <Skeleton h={28} w="60%" />
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <HeroStatCard
                    title={t('dashboard.balance')}
                    tooltip={t('dashboard.tooltip.balance')}
                    value={stats.balance}
                    familiesCount={stats.totalFamilies}
                    className="sm:col-span-2 lg:col-span-3"
                  />
                  <SmallStatCard
                    title={t('dashboard.paymentsReceived')}
                    tooltip={t('dashboard.tooltip.paymentsReceived')}
                    value={formatMoney(stats.totalIncome)}
                    icon={CurrencyDollarIcon}
                  />
                  <SmallStatCard
                    title={t('dashboard.totalExpenses')}
                    tooltip={t('dashboard.tooltip.totalExpenses')}
                    value={formatMoney(stats.totalExpenses)}
                    icon={ChartBarSquareIcon}
                  />
                </>
              ))}
            {loadingCounts ? (
              <>
                <div className="surface-card p-5">
                  <Skeleton h={14} w="50%" />
                  <div className="mt-3">
                    <Skeleton h={28} w="60%" />
                  </div>
                </div>
                <div className="surface-card p-5">
                  <Skeleton h={14} w="50%" />
                  <div className="mt-3">
                    <Skeleton h={28} w="60%" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <SmallStatCard
                  title={t('dashboard.totalFamilies')}
                  value={stats.totalFamilies}
                  icon={UserGroupIcon}
                />
                <SmallStatCard
                  title={t('dashboard.totalMembers')}
                  value={stats.totalMembers}
                  icon={UserGroupIcon}
                />
              </>
            )}
          </div>
        )}

        {showFinancials && (
          <div className="surface-card p-4 sm:p-6 max-w-md">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-fg/5 rounded-md">
                <BoltIcon className="h-5 w-5 text-fg-muted" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-fg">{t('dashboard.quickActions')}</h2>
            </div>
            <div className="space-y-1.5">
              <ActionButton
                href="/families"
                label={t('dashboard.manageFamilies')}
                icon={UserGroupIcon}
              />
              <ActionButton
                href="/calculations"
                label={t('dashboard.viewCalculations')}
                icon={CalculatorIcon}
              />
              <ActionButton
                href="/statements"
                label={t('dashboard.generateStatements')}
                icon={DocumentTextIcon}
              />
              <ActionButton
                href="/projections"
                label={t('dashboard.duesCalculator')}
                icon={ChartBarSquareIcon}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MemberWelcomeChecklist() {
  const t = useT()
  const steps = [
    { title: t('dashboard.member.browseFamilies'), href: '/families', done: false },
    { title: t('dashboard.member.viewMembers'), href: '/families', done: false },
  ]
  return (
    <section
      className="mb-8 surface-card p-5 sm:p-6 animate-ui-fade"
      aria-labelledby="member-welcome-title"
    >
      <div className="flex items-start gap-3">
        <div
          className="inline-flex items-center justify-center h-10 w-10 rounded-md bg-accent/10 text-accent shrink-0"
          aria-hidden="true"
        >
          <UserGroupIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="member-welcome-title" className="text-base font-semibold text-fg">
            {t('dashboard.welcomeKasa')}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t('dashboard.memberSubtitle')}</p>
          <ol className="mt-4 divide-y divide-border rounded-md border border-border bg-app-subtle overflow-hidden">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Link
                  href={s.href}
                  className="focus-ring flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-fg hover:bg-fg/5 transition-colors"
                >
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent"
                    aria-hidden="true"
                  >
                    {s.done ? <CheckCircleIcon className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="flex-1 truncate">{s.title}</span>
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="h-4 w-4 text-fg-subtle shrink-0 rtl:rotate-180"
                  />
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <Link
              href="/families"
              className="focus-ring inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium min-h-[var(--touch-target)] sm:min-h-0"
            >
              {t('dashboard.member.browseFamilies')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function MetricLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  const t = useT()
  if (!tooltip) {
    return <p className="text-xs uppercase tracking-wider font-medium text-fg-muted">{label}</p>
  }
  return (
    <div className="flex items-center gap-1">
      <p className="text-xs uppercase tracking-wider font-medium text-fg-muted">{label}</p>
      <Tooltip content={tooltip} side="bottom">
        <button
          type="button"
          className="text-fg-subtle hover:text-fg-muted focus-ring rounded"
          aria-label={t('dashboard.aboutMetric').replace('{label}', label)}
        >
          <InformationCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  )
}

function HeroStatCard({
  title,
  tooltip,
  value,
  familiesCount,
  className = '',
}: {
  title: string
  tooltip?: string
  value: number
  familiesCount: number
  className?: string
}) {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const isPositive = value >= 0
  return (
    <div className={`surface-card p-6 flex flex-col justify-between ${className}`}>
      <div className="flex items-center justify-between">
        <MetricLabel label={title} tooltip={tooltip} />
        <div className="p-2 bg-fg/5 rounded-md">
          <ChartBarIcon className="h-5 w-5 text-fg-muted" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <p
          className={`text-4xl sm:text-5xl font-semibold tracking-tight tabular ${isPositive ? 'text-fg' : 'text-danger'}`}
        >
          {formatMoney(Math.abs(value))}
        </p>
        <span
          className={`inline-flex items-center ${isPositive ? 'text-success' : 'text-danger'}`}
          aria-label={isPositive ? t('dashboard.positiveBalance') : t('dashboard.negativeBalance')}
        >
          {isPositive ? (
            <ArrowTrendingUpIcon className="h-5 w-5" aria-hidden="true" />
          ) : (
            <ArrowTrendingDownIcon className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        {t('dashboard.across')} {familiesCount}{' '}
        {familiesCount === 1 ? t('dashboard.familySingular') : t('dashboard.familyPlural')}
      </p>
    </div>
  )
}

function SmallStatCard({
  title,
  tooltip,
  value,
  icon: Icon,
}: {
  title: string
  tooltip?: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="surface-card p-5 hover:bg-fg/[0.02] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <MetricLabel label={title} tooltip={tooltip} />
        <div className="p-1.5 bg-fg/5 rounded-md shrink-0">
          <Icon className="h-4 w-4 text-fg-muted" />
        </div>
      </div>
      <p className="text-2xl font-semibold text-fg tabular truncate">{value}</p>
    </div>
  )
}

function ActionButton({
  href,
  label,
  icon: Icon,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link
      href={href}
      className="focus-ring flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-fg/5 transition-colors group min-h-[var(--touch-target)] sm:min-h-0"
    >
      <Icon className="h-4 w-4 text-fg-subtle group-hover:text-fg-muted" aria-hidden="true" />
      <span className="text-sm font-medium text-fg-muted group-hover:text-fg flex-1">{label}</span>
      <ChevronRightIcon
        className="h-4 w-4 text-fg-subtle group-hover:text-fg-muted shrink-0 rtl:rotate-180"
        aria-hidden="true"
      />
    </Link>
  )
}
