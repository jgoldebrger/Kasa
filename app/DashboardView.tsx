'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChartBarIcon,
  ChartBarSquareIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  PlusIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BoltIcon,
  DocumentTextIcon,
  CalculatorIcon,
  ClipboardDocumentListIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { formatLocaleDate, isFiniteDate } from '@/lib/date-utils'
import { useToast } from './components/Toast'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { useT } from '@/lib/client/i18n'
import { EmptyState, PageHeader, SkeletonRows, Tooltip } from './components/ui'
import { Skeleton } from './components/ui/Skeleton'
import OnboardingChecklist from './components/OnboardingChecklist'

interface DashboardStats {
  totalFamilies: number
  totalMembers: number
  totalIncome: number
  totalExpenses: number
  balance: number
}

interface Task {
  _id: string
  title: string
  description?: string
  dueDate: string
  email: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  relatedFamilyId?: { _id: string; name: string }
  relatedMemberId?: { _id: string; firstName: string; lastName: string }
  emailSent: boolean
}

export interface DashboardViewProps {
  initialStats?: DashboardStats
  initialTasks?: Task[]
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
  initialTasks,
  initialFinancialsComplete = true,
  initialSetupProgress = null,
  showFinancials = true,
}: DashboardViewProps = {}) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const hasInitialStats = initialStats !== undefined
  const tasksHydrated = initialTasks !== undefined
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

  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [loadingTasks, setLoadingTasks] = useState(!tasksHydrated)
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'today' | 'overdue'>('all')
  const [tasksError, setTasksError] = useState(false)
  // StrictMode-safe gating: track *what we already have data for* instead of
  // a "first run" flag (a flag is flipped on the first Strict pass and the
  // second pass would then fetch anyway). For tasks we track the filter we
  // have data for ("all" because that's what the server prefetched); for
  // stats we track a single boolean.
  const fetchedTaskFilterRef = useRef<typeof taskFilter | null>(tasksHydrated ? 'all' : null)
  const hasFetchedStatsRef = useRef(hasInitialStats && !needsFinancialCompute)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchTasksInline = useCallback(async () => {
    const gen = begin()
    setLoadingTasks(true)
    setTasksError(false)
    try {
      const params = new URLSearchParams()
      if (taskFilter !== 'all') {
        params.set('limit', '50')
        if (taskFilter === 'today') params.set('dueDate', 'today')
        else if (taskFilter === 'overdue') params.set('dueDate', 'overdue')
        else if (taskFilter === 'pending') params.set('status', 'pending')
      }
      const qs = params.toString()
      const url = qs ? `/api/tasks?${qs}` : '/api/tasks'

      const data = await cachedFetch<Task[]>(url, { ttl: 15_000 })
      if (isStale(gen)) return
      setTasks(data || [])
    } catch (error) {
      if (isStale(gen)) return
      setTasksError(true)
      setTasks([])
      toast.error(t('dashboard.error.loadTasks'))
    } finally {
      if (!isStale(gen)) setLoadingTasks(false)
    }
  }, [taskFilter, toast, begin, isStale, t])

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
      } catch (error) {
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
    if (!showFinancials) return
    // Skip refetch when we already have data for this exact filter value.
    // Critical under React StrictMode: the ref comparison (vs. a flag flip)
    // survives the dev-only effect-replay because we never mutate the ref
    // unless the filter actually changed.
    if (fetchedTaskFilterRef.current === taskFilter) return
    fetchedTaskFilterRef.current = taskFilter
    fetchTasksInline()
  }, [taskFilter, fetchTasksInline, showFinancials])

  useEffect(() => {
    if (hasFetchedStatsRef.current) return
    hasFetchedStatsRef.current = true
    fetchDashboardData(needsFinancialCompute || !hasInitialStats)
  }, [fetchDashboardData, needsFinancialCompute, hasInitialStats])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      fetchedTaskFilterRef.current = null
      hasFetchedStatsRef.current = false
      setTasks([])
      setLoadingTasks(true)
      setLoadingCounts(true)
      setLoadingFinancials(showFinancials)
      fetchedTaskFilterRef.current = taskFilter
      if (showFinancials) fetchTasksInline()
      fetchDashboardData(showFinancials)
    }, [taskFilter, fetchTasksInline, fetchDashboardData, showFinancials, invalidate]),
  )

  const pendingTasks = tasks.filter((t) => t.status === 'pending').length
  const overdueTasks = tasks.filter((t) => {
    const dueDate = new Date(t.dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return dueDate < today && t.status !== 'completed'
  }).length

  return (
    <div className="min-h-screen bg-app p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

        {showFinancials && <OnboardingChecklist initialProgress={initialSetupProgress} />}
        {!showFinancials && <MemberWelcomeChecklist />}

        {/* Stats: hero (Balance) + secondary cards */}
        {statsError && !loadingCounts && !loadingFinancials ? (
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
              showFinancials ? 'md:grid-cols-4' : 'md:grid-cols-2'
            }`}
          >
            {showFinancials && loadingFinancials ? (
              <>
                <div className="md:col-span-2 surface-card p-6">
                  <Skeleton h={14} w="30%" />
                  <div className="mt-3">
                    <Skeleton h={44} w="55%" />
                  </div>
                  <div className="mt-3">
                    <Skeleton h={12} w="40%" />
                  </div>
                </div>
                <div className="surface-card p-5">
                  <Skeleton h={14} w="50%" />
                  <div className="mt-3">
                    <Skeleton h={28} w="60%" />
                  </div>
                </div>
              </>
            ) : showFinancials ? (
              <>
                <HeroStatCard
                  title={t('dashboard.balance')}
                  tooltip={t('dashboard.tooltip.balance')}
                  value={stats.balance}
                  familiesCount={stats.totalFamilies}
                />
                <SmallStatCard
                  title={t('dashboard.paymentsReceived')}
                  tooltip={t('dashboard.tooltip.paymentsReceived')}
                  value={formatMoney(stats.totalIncome)}
                  icon={CurrencyDollarIcon}
                />
              </>
            ) : null}
            {loadingCounts ? (
              <>
                <div className="surface-card p-5">
                  <Skeleton h={14} w="50%" />
                  <div className="mt-3">
                    <Skeleton h={28} w="60%" />
                  </div>
                </div>
                {!showFinancials && (
                  <div className="surface-card p-5">
                    <Skeleton h={14} w="50%" />
                    <div className="mt-3">
                      <Skeleton h={28} w="60%" />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <SmallStatCard
                  title={t('dashboard.totalFamilies')}
                  value={stats.totalFamilies}
                  icon={UserGroupIcon}
                />
                {!showFinancials && (
                  <SmallStatCard
                    title={t('dashboard.totalMembers')}
                    value={stats.totalMembers}
                    icon={UserGroupIcon}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Main Content Grid */}
        <div className={`grid grid-cols-1 gap-6 mb-6${showFinancials ? ' lg:grid-cols-3' : ''}`}>
          {/* Tasks Section — admin-only (disputes, failed charges, etc.) */}
          {showFinancials && (
            <div className="lg:col-span-2">
              <div className="surface-card p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-fg/5 rounded-md shrink-0">
                      <CalendarIcon className="h-5 w-5 text-fg-muted" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-fg truncate">
                        {t('dashboard.tasks')}
                      </h2>
                      <p className="text-xs text-fg-muted">
                        {pendingTasks} {t('dashboard.pending')} · {overdueTasks}{' '}
                        {t('dashboard.overdue')}
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/tasks"
                    className="focus-ring inline-flex items-center gap-1.5 px-3 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium min-h-[var(--touch-target)] sm:min-h-0"
                    aria-label={t('dashboard.openTasksPage')}
                  >
                    <PlusIcon className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('dashboard.addTask')}</span>
                  </Link>
                </div>

                {/* Task Filters */}
                <div
                  className="flex flex-wrap gap-1.5 mb-4"
                  role="tablist"
                  aria-label={t('dashboard.taskFilters')}
                >
                  {(
                    [
                      { key: 'all', label: t('dashboard.filter.all') },
                      { key: 'pending', label: t('dashboard.filter.pending') },
                      { key: 'today', label: t('dashboard.filter.today') },
                      { key: 'overdue', label: t('dashboard.filter.overdue') },
                    ] as const
                  ).map((filter) => {
                    const active = taskFilter === filter.key
                    return (
                      <button
                        key={filter.key}
                        onClick={() => setTaskFilter(filter.key as any)}
                        disabled={loadingTasks}
                        role="tab"
                        aria-selected={active}
                        className={`focus-ring px-3 py-1.5 min-h-[var(--touch-target)] sm:min-h-0 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${
                          active
                            ? 'bg-fg text-app'
                            : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg'
                        }`}
                      >
                        {filter.label}
                      </button>
                    )
                  })}
                </div>

                {/* Tasks List */}
                {loadingTasks ? (
                  <SkeletonRows count={4} />
                ) : tasksError ? (
                  <EmptyState
                    icon={<ExclamationTriangleIcon />}
                    title={t('dashboard.tasksLoadError')}
                    description={t('dashboard.tasksLoadErrorDesc')}
                    cta={{
                      label: t('common.retry'),
                      onClick: () => fetchTasksInline(),
                      icon: <ArrowPathIcon className="h-4 w-4" />,
                    }}
                  />
                ) : tasks.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardDocumentListIcon />}
                    title={t('dashboard.noTasks')}
                    description={
                      taskFilter === 'all'
                        ? t('dashboard.noTasksAll')
                        : t('dashboard.noTasksFiltered')
                    }
                    cta={{ label: t('dashboard.openTasks'), href: '/tasks' }}
                  />
                ) : (
                  <div className="space-y-2">
                    {tasks.slice(0, 5).map((task) => {
                      const dueDate = new Date(task.dueDate)
                      const dueValid = Number.isFinite(dueDate.getTime())
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      const isOverdue = dueValid && dueDate < today && task.status !== 'completed'
                      const isDueToday = dueValid && dueDate.toDateString() === today.toDateString()

                      const priorityColors: Record<string, string> = {
                        low: 'bg-fg/5 text-fg-muted',
                        medium: 'bg-accent/10 text-accent',
                        high: 'bg-warning/10 text-warning',
                        urgent: 'bg-danger/10 text-danger',
                      }

                      return (
                        <Link
                          key={task._id}
                          href="/tasks"
                          className={`focus-ring block p-3 min-h-[var(--touch-target)] sm:min-h-0 rounded-md border transition-colors ${
                            isOverdue
                              ? 'bg-danger/5 border-danger/20 hover:bg-danger/10'
                              : 'bg-surface border-border hover:bg-fg/[0.03]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <h3 className="font-medium text-sm text-fg truncate">
                                  {task.title}
                                </h3>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium ${priorityColors[task.priority]}`}
                                >
                                  {task.priority}
                                </span>
                                {isDueToday && task.status !== 'completed' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium bg-warning/10 text-warning flex items-center gap-1">
                                    <ClockIcon className="h-3 w-3" aria-hidden="true" />
                                    {t('dashboard.today')}
                                  </span>
                                )}
                                {isOverdue && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium bg-danger/10 text-danger flex items-center gap-1">
                                    <ExclamationTriangleIcon
                                      className="h-3 w-3"
                                      aria-hidden="true"
                                    />
                                    {t('dashboard.overdueBadge')}
                                  </span>
                                )}
                              </div>
                              {task.description && (
                                <p className="text-xs text-fg-muted mb-1.5 line-clamp-2">
                                  {task.description}
                                </p>
                              )}
                              <div className="flex items-center gap-3 text-xs text-fg-muted flex-wrap">
                                <span className="flex items-center gap-1 tabular">
                                  <ClockIcon className="h-3 w-3" aria-hidden="true" />
                                  {formatLocaleDate(task.dueDate)}
                                </span>
                                {task.relatedFamilyId && (
                                  <span className="flex items-center gap-1">
                                    <UserGroupIcon className="h-3 w-3" aria-hidden="true" />
                                    {task.relatedFamilyId.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                    {tasks.length > 5 && (
                      <div className="text-center pt-3">
                        <Link
                          href="/tasks"
                          className="focus-ring text-accent hover:text-accent-hover font-medium text-sm inline-flex items-center gap-1 rounded"
                        >
                          {t('dashboard.viewAll')} {tasks.length} {t('dashboard.tasksWord')}{' '}
                          <ChevronRightIcon className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="space-y-6">
            <div className="surface-card p-4 sm:p-6">
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
                {showFinancials && (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
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
}: {
  title: string
  tooltip?: string
  value: number
  familiesCount: number
}) {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const isPositive = value >= 0
  return (
    <div className="md:col-span-2 surface-card p-6 flex flex-col justify-between">
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
