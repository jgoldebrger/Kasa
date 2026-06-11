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
  SparklesIcon,
  BoltIcon,
  DocumentTextIcon,
  CalculatorIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { formatLocaleDate, isFiniteDate } from '@/lib/date-utils'
import { useToast } from './components/Toast'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { EmptyState, PageHeader, SkeletonRows } from './components/ui'
import { Skeleton } from './components/ui/Skeleton'

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
  /** When false, hide org-wide balance/income and admin quick actions. */
  showFinancials?: boolean
}

export default function DashboardView({
  initialStats,
  initialTasks,
  showFinancials = true,
}: DashboardViewProps = {}) {
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  const hasInitialStats = initialStats !== undefined
  const hasInitialTasks = Array.isArray(initialTasks) && initialTasks.length > 0
  const [stats, setStats] = useState<DashboardStats>(
    initialStats ?? {
      totalFamilies: 0,
      totalMembers: 0,
      totalIncome: 0,
      totalExpenses: 0,
      balance: 0,
    },
  )
  const [loadingStats, setLoadingStats] = useState(!hasInitialStats)
  const [statsError, setStatsError] = useState(false)

  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [loadingTasks, setLoadingTasks] = useState(!hasInitialTasks)
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'today' | 'overdue'>('all')
  const [tasksError, setTasksError] = useState(false)
  // StrictMode-safe gating: track *what we already have data for* instead of
  // a "first run" flag (a flag is flipped on the first Strict pass and the
  // second pass would then fetch anyway). For tasks we track the filter we
  // have data for ("all" because that's what the server prefetched); for
  // stats we track a single boolean.
  const fetchedTaskFilterRef = useRef<typeof taskFilter | null>(
    hasInitialTasks ? 'all' : null,
  )
  const hasFetchedStatsRef = useRef(hasInitialStats)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchTasksInline = useCallback(async () => {
    const gen = begin()
    setLoadingTasks(true)
    setTasksError(false)
    try {
      let url = '/api/tasks'
      if (taskFilter === 'today') url += '?dueDate=today'
      else if (taskFilter === 'overdue') url += '?dueDate=overdue'
      else if (taskFilter === 'pending') url += '?status=pending'

      const data = await cachedFetch<Task[]>(url, { ttl: 15_000 })
      if (isStale(gen)) return
      setTasks(data || [])
    } catch (error) {
      if (isStale(gen)) return
      setTasksError(true)
      setTasks([])
      toast.error('Could not load tasks. Pull to refresh or try again.')
    } finally {
      if (!isStale(gen)) setLoadingTasks(false)
    }
  }, [taskFilter, toast, begin, isStale])

  const fetchDashboardData = useCallback(async () => {
    const gen = begin()
    setStatsError(false)
    try {
      const data = await cachedFetch<{
        totalFamilies: number
        totalMembers: number
        calculatedIncome: number
        calculatedExpenses: number
        balance: number
      }>(`/api/dashboard-stats`, { ttl: 30_000 })
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
      toast.error('Could not load dashboard stats.')
    } finally {
      if (!isStale(gen)) setLoadingStats(false)
    }
  }, [toast, showFinancials, begin, isStale])

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
    fetchDashboardData()
  }, [fetchDashboardData])

  useOrgChanged(useCallback(() => {
    invalidate()
    fetchedTaskFilterRef.current = null
    hasFetchedStatsRef.current = false
    setTasks([])
    setLoadingTasks(true)
    setLoadingStats(true)
    fetchedTaskFilterRef.current = taskFilter
    if (showFinancials) fetchTasksInline()
    fetchDashboardData()
  }, [taskFilter, fetchTasksInline, fetchDashboardData, showFinancials, invalidate]))

  const isFirstRun = !loadingStats && !statsError && stats.totalFamilies === 0

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
        <PageHeader
          title="Dashboard"
          subtitle="Welcome back — here's your workspace at a glance."
        />

        {isFirstRun && <FirstRunChecklist />}

        {/* Stats: hero (Balance) + secondary cards */}
        <div
          className={`grid grid-cols-1 gap-4 mb-8 ${
            showFinancials ? 'md:grid-cols-4' : 'md:grid-cols-2'
          }`}
        >
          {loadingStats && showFinancials ? (
            <>
              <div className="md:col-span-2 surface-card p-6">
                <Skeleton h={14} w="30%" />
                <div className="mt-3"><Skeleton h={44} w="55%" /></div>
                <div className="mt-3"><Skeleton h={12} w="40%" /></div>
              </div>
              <div className="surface-card p-5"><Skeleton h={14} w="50%" /><div className="mt-3"><Skeleton h={28} w="60%" /></div></div>
              <div className="surface-card p-5"><Skeleton h={14} w="50%" /><div className="mt-3"><Skeleton h={28} w="60%" /></div></div>
            </>
          ) : (
            <>
              {showFinancials && (
                <>
                  <HeroStatCard
                    title="Balance"
                    value={stats.balance}
                    familiesCount={stats.totalFamilies}
                  />
                  <SmallStatCard title="Total Income" value={formatMoney(stats.totalIncome)} icon={CurrencyDollarIcon} />
                </>
              )}
              <SmallStatCard title="Total Families" value={stats.totalFamilies} icon={UserGroupIcon} />
              {!showFinancials && (
                <SmallStatCard title="Total Members" value={stats.totalMembers} icon={UserGroupIcon} />
              )}
            </>
          )}
        </div>

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
                    <h2 className="text-base font-semibold text-fg truncate">Tasks</h2>
                    <p className="text-xs text-fg-muted">
                      {pendingTasks} pending · {overdueTasks} overdue
                    </p>
                  </div>
                </div>
                <Link
                  href="/tasks"
                  className="focus-ring inline-flex items-center gap-1.5 px-3 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium min-h-[var(--touch-target)] sm:min-h-0"
                  aria-label="Open tasks page"
                >
                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Add Task</span>
                </Link>
              </div>

              {/* Task Filters */}
              <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Task filters">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'pending', label: 'Pending' },
                  { key: 'today', label: 'Due Today' },
                  { key: 'overdue', label: 'Overdue' },
                ].map((filter) => {
                  const active = taskFilter === filter.key
                  return (
                    <button
                      key={filter.key}
                      onClick={() => setTaskFilter(filter.key as any)}
                      role="tab"
                      aria-selected={active}
                      className={`focus-ring px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        active ? 'bg-fg text-app' : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg'
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
                  title="Couldn't load tasks"
                  description="Check your connection and try again."
                  cta={{ label: 'Retry', onClick: () => fetchTasksInline(), icon: <ArrowPathIcon className="h-4 w-4" /> }}
                />
              ) : tasks.length === 0 ? (
                <EmptyState
                  icon={<ClipboardDocumentListIcon />}
                  title="No tasks here yet"
                  description={
                    taskFilter === 'all'
                      ? 'Create a task to track follow-ups, deadlines, and reminders.'
                      : 'Try switching the filter or create a new task.'
                  }
                  cta={{ label: 'Open tasks', href: '/tasks' }}
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
                      high: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300',
                      urgent: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
                    }

                    return (
                      <Link
                        key={task._id}
                        href="/tasks"
                        className={`focus-ring block p-3 rounded-md border transition-colors ${
                          isOverdue
                            ? 'bg-red-50/30 dark:bg-red-500/5 border-red-200/60 dark:border-red-500/20 hover:bg-red-50/50 dark:hover:bg-red-500/10'
                            : 'bg-surface border-border hover:bg-fg/[0.03]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <h3 className="font-medium text-sm text-fg truncate">{task.title}</h3>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium ${priorityColors[task.priority]}`}>
                                {task.priority}
                              </span>
                              {isDueToday && task.status !== 'completed' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300 flex items-center gap-1">
                                  <ClockIcon className="h-3 w-3" aria-hidden="true" />
                                  Today
                                </span>
                              )}
                              {isOverdue && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 flex items-center gap-1">
                                  <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                                  Overdue
                                </span>
                              )}
                            </div>
                            {task.description && (
                              <p className="text-xs text-fg-muted mb-1.5 line-clamp-2">{task.description}</p>
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
                        View all {tasks.length} tasks <span aria-hidden="true">→</span>
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
                <h2 className="text-base font-semibold text-fg">Quick Actions</h2>
              </div>
              <div className="space-y-1.5">
                <ActionButton href="/families" label="Manage Families" icon={UserGroupIcon} />
                {showFinancials && (
                  <>
                    <ActionButton href="/calculations" label="View Calculations" icon={CalculatorIcon} />
                    <ActionButton href="/statements" label="Generate Statements" icon={DocumentTextIcon} />
                    <ActionButton href="/projections" label="Dues calculator" icon={ChartBarSquareIcon} />
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

function FirstRunChecklist() {
  const steps = [
    { title: 'Add your first family', href: '/families', done: false },
    { title: 'Set up payment plans', href: '/settings', done: false },
    { title: 'Configure your cycle start month', href: '/settings', done: false },
  ]
  return (
    <section
      className="mb-8 surface-card p-5 sm:p-6 animate-ui-fade"
      aria-labelledby="first-run-title"
    >
      <div className="flex items-start gap-3">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-md bg-accent/10 text-accent shrink-0" aria-hidden="true">
          <SparklesIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="first-run-title" className="text-base font-semibold text-fg">
            Welcome to Kasa
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Let&apos;s get you set up in three quick steps.
          </p>
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
                  <span aria-hidden="true" className="text-fg-subtle">→</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

function HeroStatCard({
  title,
  value,
  familiesCount,
}: {
  title: string
  value: number
  familiesCount: number
}) {
  const { format: formatMoney } = useCurrency()
  const isPositive = value >= 0
  return (
    <div className="md:col-span-2 surface-card p-6 flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider font-medium text-fg-muted">{title}</p>
        <div className="p-2 bg-fg/5 rounded-md">
          <ChartBarIcon className="h-5 w-5 text-fg-muted" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <p className={`text-4xl sm:text-5xl font-semibold tracking-tight tabular ${isPositive ? 'text-fg' : 'text-red-600 dark:text-red-400'}`}>
          {formatMoney(Math.abs(value))}
        </p>
        <span className={`inline-flex items-center ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} aria-label={isPositive ? 'Positive balance' : 'Negative balance'}>
          {isPositive ? (
            <ArrowTrendingUpIcon className="h-5 w-5" aria-hidden="true" />
          ) : (
            <ArrowTrendingDownIcon className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        Across {familiesCount} {familiesCount === 1 ? 'family' : 'families'}
      </p>
    </div>
  )
}

function SmallStatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="surface-card p-5 hover:bg-fg/[0.02] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs uppercase tracking-wider font-medium text-fg-muted">{title}</p>
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
      <span className="text-sm font-medium text-fg-muted group-hover:text-fg">{label}</span>
    </Link>
  )
}
