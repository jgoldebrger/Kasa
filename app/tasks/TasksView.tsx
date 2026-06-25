'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import {
  PlusIcon,
  CheckCircleIcon,
  TrashIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentListIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { useToast, useConfirm } from '@/app/components/Toast'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { formatLocaleDate } from '@/lib/date-utils'
import {
  TASKS_LIST_PAGE_SIZE,
  collectAllTasksPages,
  parseTasksListResponse,
  tasksListUrl,
} from '@/lib/client/tasks-list'
import {
  ActionMenu,
  Badge,
  Button,
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
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import { sortTaskRows } from '@/lib/tasks/sort-tasks'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

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
  relatedPaymentId?: string
  emailSent: boolean
  completedAt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface TasksViewProps {
  initialTasks?: Task[]
  initialNextCursor?: string | null
}

const PRIORITY_VARIANT: Record<Task['priority'], BadgeProps['variant']> = {
  low: 'muted',
  medium: 'accent',
  high: 'warning',
  urgent: 'danger',
}

const STATUS_VARIANT: Record<Task['status'], BadgeProps['variant']> = {
  pending: 'warning',
  in_progress: 'accent',
  completed: 'success',
  cancelled: 'muted',
}

const PRIORITY_KEYS: Record<Task['priority'], MessageKey> = {
  low: 'tasks.priority.low',
  medium: 'tasks.priority.medium',
  high: 'tasks.priority.high',
  urgent: 'tasks.priority.urgent',
}

const STATUS_KEYS: Record<Task['status'], MessageKey> = {
  pending: 'tasks.status.pending',
  in_progress: 'tasks.status.in_progress',
  completed: 'tasks.status.completed',
  cancelled: 'tasks.status.cancelled',
}

const TASK_STATUSES: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const TASK_PRIORITIES: Task['priority'][] = ['low', 'medium', 'high', 'urgent']

function taskFilterQuery(filter: 'all' | 'pending' | 'today' | 'overdue'): string {
  if (filter === 'today') return 'dueDate=today'
  if (filter === 'overdue') return 'dueDate=overdue'
  if (filter === 'pending') return 'status=pending'
  return ''
}

function taskFamilyName(task: Task): string {
  return task.relatedFamilyId?.name || ''
}

function isTaskOverdue(task: Task): boolean {
  const dueDate = new Date(task.dueDate)
  if (!Number.isFinite(dueDate.getTime()) || task.status === 'completed') return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return dueDate < today
}

function isTaskDueToday(task: Task): boolean {
  const dueDate = new Date(task.dueDate)
  if (!Number.isFinite(dueDate.getTime()) || task.status === 'completed') return false
  const today = new Date()
  return dueDate.toDateString() === today.toDateString()
}

export default function TasksView({ initialTasks, initialNextCursor = null }: TasksViewProps = {}) {
  const toast = useToast()
  const t = useT()
  const confirm = useConfirm()
  const tasksHydrated = initialTasks !== undefined
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [loadingTasks, setLoadingTasks] = useState(!tasksHydrated)
  const [loadingMore, setLoadingMore] = useState(false)
  const [tasksError, setTasksError] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'today' | 'overdue'>('all')
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [exportExpanding, setExportExpanding] = useState(false)
  const fetchedTaskFilterRef = useRef<typeof taskFilter | null>(tasksHydrated ? 'all' : null)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const BULK_SELECTION_CAP = 100

  const fetchTasks = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      const gen = begin()
      const append = opts?.append ?? false
      try {
        if (append) setLoadingMore(true)
        else {
          setLoadingTasks(true)
          setTasksError(false)
        }
        const url = tasksListUrl(opts?.cursor, TASKS_LIST_PAGE_SIZE, taskFilterQuery(taskFilter))
        const res = await fetch(url)
        if (isStale(gen)) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => null)
        if (isStale(gen)) return
        const { items, nextCursor: pageNext } = parseTasksListResponse<Task>(data)
        setTasks((prev) => (append ? [...prev, ...items] : items))
        setNextCursor(pageNext)
        if (!append) setSelectedIds(new Set())
      } catch {
        if (isStale(gen)) return
        if (!append) {
          setTasks([])
          setNextCursor(null)
          setTasksError(true)
          toast.error(t('tasks.error.load'))
        } else {
          toast.error(t('tasks.error.loadMore'))
        }
      } finally {
        if (!isStale(gen)) {
          setLoadingTasks(false)
          setLoadingMore(false)
        }
      }
    },
    [taskFilter, toast, begin, isStale, t],
  )

  useEffect(() => {
    if (fetchedTaskFilterRef.current === taskFilter) return
    fetchedTaskFilterRef.current = taskFilter
    setNextCursor(null)
    fetchTasks()
  }, [taskFilter, fetchTasks])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      fetchedTaskFilterRef.current = null
      setTasks([])
      setNextCursor(null)
      setSelectedIds(new Set())
      setLoadingTasks(true)
      fetchedTaskFilterRef.current = taskFilter
      fetchTasks()
    }, [taskFilter, fetchTasks, invalidate]),
  )

  const expandExportRows = useCallback(async () => {
    if (!nextCursor) return
    const gen = begin()
    setExportExpanding(true)
    toast.info(t('tasks.export.loading'))
    try {
      const all = await collectAllTasksPages<Task>(async (cursor) => {
        const res = await fetch(
          tasksListUrl(cursor, TASKS_LIST_PAGE_SIZE, taskFilterQuery(taskFilter)),
        )
        if (isStale(gen)) return { items: [], nextCursor: null }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => null)
        return parseTasksListResponse<Task>(data)
      })
      if (isStale(gen)) return
      setTasks(all)
      setNextCursor(null)
      return all
    } catch {
      if (!isStale(gen)) toast.error(t('tasks.error.load'))
    } finally {
      if (!isStale(gen)) setExportExpanding(false)
    }
  }, [nextCursor, begin, isStale, taskFilter, toast, t])

  const sortedTasks = useMemo(
    () =>
      sortTaskRows(
        tasks.map((task) => ({ ...task, familyName: taskFamilyName(task) })),
        sort,
      ),
    [tasks, sort],
  )

  const statusOptions = useMemo(
    () => TASK_STATUSES.map((value) => ({ value, label: t(STATUS_KEYS[value]) })),
    [t],
  )

  const priorityOptions = useMemo(
    () => TASK_PRIORITIES.map((value) => ({ value, label: t(PRIORITY_KEYS[value]) })),
    [t],
  )

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllVisible = (rows: Task[]) => {
    setSelectedIds((prev) => {
      const visibleIds = rows.map((r) => r._id)
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id))
      if (allSelected) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      let added = 0
      for (const id of visibleIds) {
        if (next.has(id)) continue
        if (next.size >= BULK_SELECTION_CAP) break
        next.add(id)
        added += 1
      }
      if (added < visibleIds.length - prev.size) {
        toast.error(
          t('tasks.bulkSelectionCap').replace('{cap}', BULK_SELECTION_CAP.toLocaleString()),
        )
      }
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const completeTask = async (taskId: string) => {
    const prev = tasks
    setTasks((cur) =>
      cur.map((task) => (task._id === taskId ? { ...task, status: 'completed' as const } : task)),
    )
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) throw new Error()
      invalidateCache(/^\/api\/tasks/)
      toast.success(t('tasks.success.completed'))
    } catch {
      setTasks(prev)
      toast.error(t('tasks.error.complete'))
    }
  }

  const deleteTask = async (task: Task) => {
    if (
      !(await confirm({
        title: t('tasks.confirm.deleteTitle'),
        message: t('tasks.confirm.deleteMessage').replace('{title}', task.title),
        destructive: true,
        confirmLabel: t('common.delete'),
      }))
    )
      return
    try {
      const res = await fetch(`/api/tasks/${task._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      invalidateCache(/^\/api\/tasks/)
      fetchTasks()
      toast.success(t('tasks.success.deleted'))
    } catch {
      toast.error(t('tasks.error.delete'))
    }
  }

  const handleBulkComplete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    setBulkBusy(true)
    try {
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', ids }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('tasks.error.bulkComplete'))
        return
      }
      toast.success(
        t('tasks.success.bulkCompleted').replace('{count}', String(data.modified || ids.length)),
      )
      clearSelection()
      invalidateCache(/^\/api\/tasks/)
      fetchTasks()
    } catch {
      toast.error(t('common.networkErrorShort'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const ok = await confirm({
      title: t('tasks.bulkDeleteTitle')
        .replace('{count}', String(ids.length))
        .replace('{unit}', ids.length === 1 ? t('tasks.taskUnit') : t('tasks.tasksUnit')),
      message: t('tasks.bulkDeleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    })
    if (!ok) return

    setBulkBusy(true)
    try {
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('tasks.error.bulkDelete'))
        return
      }
      toast.success(
        t('tasks.success.bulkDeleted').replace('{count}', String(data.modified || ids.length)),
      )
      clearSelection()
      invalidateCache(/^\/api\/tasks/)
      fetchTasks()
    } catch {
      toast.error(t('common.networkErrorShort'))
    } finally {
      setBulkBusy(false)
    }
  }

  const columns: DataColumn<Task>[] = useMemo(
    () => [
      {
        id: 'select',
        header: (
          <input
            type="checkbox"
            aria-label={t('tasks.selectAll')}
            title={t('tasks.selectAll')}
            className="cursor-pointer"
            checked={
              sortedTasks.length > 0 && sortedTasks.every((task) => selectedIds.has(task._id))
            }
            ref={(el) => {
              if (el) {
                const someSelected = sortedTasks.some((task) => selectedIds.has(task._id))
                const allSelected =
                  sortedTasks.length > 0 && sortedTasks.every((task) => selectedIds.has(task._id))
                el.indeterminate = someSelected && !allSelected
              }
            }}
            onChange={() => toggleSelectAllVisible(sortedTasks)}
          />
        ),
        headerText: '',
        cell: (task) => (
          <input
            type="checkbox"
            aria-label={t('tasks.selectTask').replace('{title}', task.title)}
            className="cursor-pointer"
            checked={selectedIds.has(task._id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleSelect(task._id)}
          />
        ),
        exportValue: () => '',
        className: 'w-8',
      },
      {
        id: 'title',
        header: t('tasks.column.title'),
        headerText: t('tasks.column.title'),
        sortable: true,
        cell: (task) => <span className="font-medium text-fg break-words">{task.title}</span>,
        exportValue: (task) => task.title,
      },
      {
        id: 'dueDate',
        header: t('tasks.column.dueDate'),
        headerText: t('tasks.column.dueDate'),
        sortable: true,
        cell: (task) => (
          <div className="flex flex-wrap items-center gap-1">
            <span className={`tabular ${isTaskOverdue(task) ? 'text-danger font-medium' : ''}`}>
              {formatLocaleDate(task.dueDate)}
            </span>
            {isTaskDueToday(task) && (
              <Badge variant="warning" size="sm" className="gap-1">
                <ClockIcon className="h-3 w-3" aria-hidden="true" />
                {t('tasks.dueToday')}
              </Badge>
            )}
            {isTaskOverdue(task) && (
              <Badge variant="danger" size="sm" className="gap-1">
                <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                {t('tasks.overdue')}
              </Badge>
            )}
          </div>
        ),
        exportValue: (task) => (task.dueDate ? new Date(task.dueDate) : ''),
        filter: { type: 'dateRange', getValue: (task) => task.dueDate || null },
      },
      {
        id: 'priority',
        header: t('tasks.column.priority'),
        headerText: t('tasks.column.priority'),
        sortable: true,
        cell: (task) => (
          <Badge variant={PRIORITY_VARIANT[task.priority]} size="md">
            {t(PRIORITY_KEYS[task.priority])}
          </Badge>
        ),
        exportValue: (task) => t(PRIORITY_KEYS[task.priority]),
        filter: {
          type: 'multiselect',
          getValue: (task) => task.priority,
          options: priorityOptions,
        },
      },
      {
        id: 'status',
        header: t('tasks.column.status'),
        headerText: t('tasks.column.status'),
        sortable: true,
        cell: (task) => (
          <Badge variant={STATUS_VARIANT[task.status]} size="md">
            {t(STATUS_KEYS[task.status])}
          </Badge>
        ),
        exportValue: (task) => t(STATUS_KEYS[task.status]),
        filter: {
          type: 'multiselect',
          getValue: (task) => task.status,
          options: statusOptions,
        },
      },
      {
        id: 'family',
        header: t('tasks.column.family'),
        headerText: t('tasks.column.family'),
        sortable: true,
        hideBelow: 'md',
        cell: (task) =>
          task.relatedFamilyId ? (
            <Link
              href={`/families/${task.relatedFamilyId._id}`}
              className="text-accent hover:text-accent-hover hover:underline focus-ring rounded"
            >
              {task.relatedFamilyId.name}
            </Link>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
        exportValue: (task) => taskFamilyName(task),
      },
      {
        id: 'email',
        header: t('tasks.column.email'),
        headerText: t('tasks.column.email'),
        sortable: true,
        hideBelow: 'lg',
        cell: (task) => <span className="text-fg-muted">{task.email}</span>,
        exportValue: (task) => task.email,
      },
      {
        id: 'actions',
        header: '',
        headerText: t('common.actions'),
        align: 'right',
        cell: (task) => (
          <div className="flex items-center justify-end gap-1">
            {task.status !== 'completed' && (
              <button
                onClick={() => completeTask(task._id)}
                aria-label={t('tasks.completeAria').replace('{title}', task.title)}
                title={t('tasks.completeTitle')}
                className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-full text-success hover:bg-success/10 transition-colors"
              >
                <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <ActionMenu
              ariaLabel={t('tasks.actionsFor').replace('{title}', task.title)}
              items={[
                ...(task.status !== 'completed'
                  ? [
                      {
                        label: t('tasks.completeTitle'),
                        icon: <CheckCircleIcon className="h-4 w-4" />,
                        onClick: () => completeTask(task._id),
                      },
                    ]
                  : []),
                {
                  label: t('tasks.deleteTitle'),
                  icon: <TrashIcon className="h-4 w-4" />,
                  destructive: true,
                  onClick: () => deleteTask(task),
                },
              ]}
            />
          </div>
        ),
        exportValue: () => '',
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row handlers close over latest tasks/toast
    [sortedTasks, selectedIds, statusOptions, priorityOptions, t],
  )

  const emptyState = (
    <EmptyState
      icon={<ClipboardDocumentListIcon />}
      title={taskFilter === 'all' ? t('tasks.empty.all.title') : t('tasks.empty.filtered.title')}
      description={
        taskFilter === 'all'
          ? t('tasks.empty.all.description')
          : t('tasks.empty.filtered.description')
      }
      cta={{
        label: t('tasks.addTask'),
        onClick: () => setShowTaskModal(true),
        icon: <PlusIcon className="h-4 w-4" />,
      }}
    />
  )

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('tasks.title')}
          subtitle={t('tasks.subtitle')}
          actions={
            <Button
              leftIcon={<PlusIcon className="h-5 w-5" />}
              onClick={() => setShowTaskModal(true)}
            >
              {t('tasks.addTask')}
            </Button>
          }
        />

        <Card className="mb-4">
          <Tabs
            items={[
              { id: 'all', label: t('tasks.filters.all') },
              { id: 'pending', label: t('tasks.filters.pending') },
              { id: 'today', label: t('tasks.filters.today') },
              { id: 'overdue', label: t('tasks.filters.overdue') },
            ]}
            activeId={taskFilter}
            onChange={(id) => setTaskFilter(id as typeof taskFilter)}
            label={t('tasks.filters.label')}
          />
        </Card>

        {selectedIds.size > 0 && (
          <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 shadow-sm">
            <span className="text-sm font-medium text-fg">
              {selectedIds.size} {t('tasks.selected')}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-fg-muted hover:text-fg underline"
            >
              {t('common.clear')}
            </button>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={handleBulkComplete}>
              {t('tasks.bulkComplete')}
            </Button>
            <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={handleBulkDelete}>
              {t('common.delete')}
            </Button>
          </div>
        )}

        {loadingTasks ? (
          <Card>
            <SkeletonRows count={8} />
          </Card>
        ) : tasksError ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title={t('tasks.loadError.title')}
            description={t('tasks.loadError.description')}
            cta={{
              label: t('common.retry'),
              onClick: () => fetchTasks(),
              icon: <ArrowPathIcon className="h-4 w-4" />,
            }}
          />
        ) : (
          <DataView
            tableId="tasks"
            rows={sortedTasks}
            columns={columns}
            rowKey={(task) => task._id}
            sort={sort}
            onSortChange={(id, dir) => setSort({ id, dir })}
            globalSearch={{ placeholder: t('tasks.searchPlaceholder') }}
            pageSize={10}
            expandExportRows={nextCursor ? expandExportRows : undefined}
            exportExpanding={exportExpanding}
            mobileCard={(task) => (
              <TaskMobileCard
                task={task}
                onComplete={() => completeTask(task._id)}
                onDelete={() => deleteTask(task)}
              />
            )}
            empty={emptyState}
          />
        )}

        {!loadingTasks && !tasksError && nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={loadingMore}
              onClick={() => fetchTasks({ cursor: nextCursor, append: true })}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        )}
      </div>

      <TaskFormModal
        open={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onCreated={() => fetchTasks()}
      />
    </div>
  )
}

function TaskMobileCard({
  task,
  onComplete,
  onDelete,
}: {
  task: Task
  onComplete: () => void
  onDelete: () => void
}) {
  const t = useT()
  const overdue = isTaskOverdue(task)
  return (
    <Card compact className={overdue ? 'border-danger/30 bg-danger/5' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-fg break-words">{task.title}</h3>
        <div className="flex items-center gap-1 shrink-0">
          {task.status !== 'completed' && (
            <button
              onClick={onComplete}
              aria-label={t('tasks.completeAria').replace('{title}', task.title)}
              title={t('tasks.completeTitle')}
              className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-full text-success hover:bg-success/10"
            >
              <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <button
            onClick={onDelete}
            aria-label={t('tasks.deleteAria').replace('{title}', task.title)}
            title={t('tasks.deleteTitle')}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-full text-danger hover:bg-danger/10"
          >
            <TrashIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
        <div>
          <dt className="text-fg-muted">{t('tasks.mobile.due')}</dt>
          <dd className="tabular">{formatLocaleDate(task.dueDate)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t('tasks.mobile.priority')}</dt>
          <dd>
            <Badge variant={PRIORITY_VARIANT[task.priority]} size="md">
              {t(PRIORITY_KEYS[task.priority])}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t('tasks.mobile.status')}</dt>
          <dd>
            <Badge variant={STATUS_VARIANT[task.status]} size="md">
              {t(STATUS_KEYS[task.status])}
            </Badge>
          </dd>
        </div>
        {task.relatedFamilyId && (
          <div>
            <dt className="text-fg-muted">{t('tasks.mobile.family')}</dt>
            <dd>
              <Link
                href={`/families/${task.relatedFamilyId._id}`}
                className="text-accent hover:underline focus-ring rounded"
              >
                {task.relatedFamilyId.name}
              </Link>
            </dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className="text-fg-muted">{t('tasks.column.email')}</dt>
          <dd>{task.email}</dd>
        </div>
      </dl>
    </Card>
  )
}
