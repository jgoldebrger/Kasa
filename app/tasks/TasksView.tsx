'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  PlusIcon,
  CheckCircleIcon,
  TrashIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline'
import { useToast, useConfirm } from '@/app/components/Toast'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { formatLocaleDate } from '@/lib/date-utils'
import { TASKS_LIST_PAGE_SIZE, parseTasksListResponse, tasksListUrl } from '@/lib/client/tasks-list'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tabs,
} from '@/app/components/ui'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import type { BadgeProps } from '@/app/components/ui'

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

function taskFilterQuery(filter: 'all' | 'pending' | 'today' | 'overdue'): string {
  if (filter === 'today') return 'dueDate=today'
  if (filter === 'overdue') return 'dueDate=overdue'
  if (filter === 'pending') return 'status=pending'
  return ''
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
  const fetchedTaskFilterRef = useRef<typeof taskFilter | null>(tasksHydrated ? 'all' : null)
  const { begin, invalidate, isStale } = useRequestGeneration()

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
        const { items, nextCursor: pageNext } = parseTasksListResponse(data)
        setTasks((prev) => (append ? [...prev, ...(items as Task[])] : (items as Task[])))
        setNextCursor(pageNext)
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
      setLoadingTasks(true)
      fetchedTaskFilterRef.current = taskFilter
      fetchTasks()
    }, [taskFilter, fetchTasks, invalidate]),
  )

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

        <Card className="mb-6">
          <div className="mb-4">
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
          </div>

          {loadingTasks ? (
            <SkeletonRows count={5} />
          ) : tasksError ? (
            <EmptyState
              icon={<ExclamationTriangleIcon />}
              title={t('tasks.loadError.title')}
              description={t('tasks.loadError.description')}
              cta={{ label: t('common.retry'), onClick: () => fetchTasks() }}
            />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={<ClipboardDocumentListIcon />}
              title={
                taskFilter === 'all' ? t('tasks.empty.all.title') : t('tasks.empty.filtered.title')
              }
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
          ) : (
            <>
              <ul className="space-y-3">
                {tasks.map((task) => {
                  const dueDate = new Date(task.dueDate)
                  const dueValid = Number.isFinite(dueDate.getTime())
                  const today = new Date()
                  today.setHours(0, 0, 0, 0)
                  const isOverdue = dueValid && dueDate < today && task.status !== 'completed'
                  const isDueToday = dueValid && dueDate.toDateString() === today.toDateString()

                  return (
                    <li key={task._id}>
                      <Card
                        compact
                        className={isOverdue ? 'border-danger/30 bg-danger/5' : undefined}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <h3 className="font-semibold text-fg break-words">{task.title}</h3>
                              <Badge variant={PRIORITY_VARIANT[task.priority]} size="md">
                                {t(PRIORITY_KEYS[task.priority])}
                              </Badge>
                              <Badge variant={STATUS_VARIANT[task.status]} size="md">
                                {t(STATUS_KEYS[task.status])}
                              </Badge>
                              {isDueToday && task.status !== 'completed' && (
                                <Badge variant="warning" size="md" className="gap-1">
                                  <ClockIcon className="h-3 w-3" aria-hidden="true" />
                                  {t('tasks.dueToday')}
                                </Badge>
                              )}
                              {isOverdue && (
                                <Badge variant="danger" size="md" className="gap-1">
                                  <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                                  {t('tasks.overdue')}
                                </Badge>
                              )}
                            </div>
                            {task.description && (
                              <p className="text-sm text-fg mb-2">{task.description}</p>
                            )}
                            <div className="flex items-center gap-x-4 gap-y-1 text-xs text-fg-muted flex-wrap">
                              <span>
                                {t('tasks.due')}: {formatLocaleDate(task.dueDate)}
                              </span>
                              <span>
                                {t('tasks.emailLabel')}: {task.email}
                              </span>
                              {task.relatedFamilyId && (
                                <span>
                                  {t('tasks.familyLabel')}: {task.relatedFamilyId.name}
                                </span>
                              )}
                              {task.relatedMemberId && (
                                <span>
                                  {t('tasks.memberLabel')}: {task.relatedMemberId.firstName}{' '}
                                  {task.relatedMemberId.lastName}
                                </span>
                              )}
                              {task.emailSent && (
                                <span className="text-success">{t('tasks.emailSent')}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 self-end sm:self-start">
                            {task.status !== 'completed' && (
                              <button
                                onClick={() => completeTask(task._id)}
                                aria-label={t('tasks.completeAria').replace('{title}', task.title)}
                                title={t('tasks.completeTitle')}
                                className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-success hover:bg-success/10 transition-colors"
                              >
                                <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                              </button>
                            )}
                            <button
                              onClick={() => deleteTask(task)}
                              aria-label={t('tasks.deleteAria').replace('{title}', task.title)}
                              title={t('tasks.deleteTitle')}
                              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors"
                            >
                              <TrashIcon className="h-5 w-5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
              {nextCursor && (
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
            </>
          )}
        </Card>
      </div>

      <TaskFormModal
        open={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onCreated={() => fetchTasks()}
      />
    </div>
  )
}
