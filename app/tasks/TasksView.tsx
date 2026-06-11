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
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { formatLocaleDate } from '@/lib/date-utils'
import {
  Button,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tabs,
} from '@/app/components/ui'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'

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
  initialFamilies?: any[]
}

export default function TasksView({
  initialTasks,
  initialFamilies,
}: TasksViewProps = {}) {
  const toast = useToast()
  const confirm = useConfirm()
  const hasInitialTasks = Array.isArray(initialTasks) && initialTasks.length > 0
  const hasInitialFamilies = Array.isArray(initialFamilies) && initialFamilies.length > 0
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [loadingTasks, setLoadingTasks] = useState(!hasInitialTasks)
  const [tasksError, setTasksError] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'today' | 'overdue'>('all')
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [families, setFamilies] = useState<any[]>(initialFamilies ?? [])
  // StrictMode-safe gates. Tasks tracks the filter value it has data for
  // (so changing filter still triggers a fetch) and families tracks a
  // single bool. Never mutate inside the effect body without also using
  // a value that survives the React 18 dev-mode double-invoke.
  const fetchedTaskFilterRef = useRef<typeof taskFilter | null>(
    hasInitialTasks ? 'all' : null,
  )
  const hasFetchedFamiliesRef = useRef(hasInitialFamilies)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchTasks = useCallback(async () => {
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
    } catch {
      if (isStale(gen)) return
      setTasks([])
      setTasksError(true)
      toast.error('Could not load tasks.')
    } finally {
      if (!isStale(gen)) setLoadingTasks(false)
    }
  }, [taskFilter, toast, begin, isStale])

  const fetchFamilies = useCallback(async () => {
    const gen = begin()
    try {
      const data = await cachedFetch<any>('/api/families', { ttl: 30_000 })
      if (isStale(gen)) return
      if (data) setFamilies(data)
    } catch {
      // Best-effort — the page still works without family options.
    }
  }, [begin, isStale])

  useEffect(() => {
    if (fetchedTaskFilterRef.current === taskFilter) return
    fetchedTaskFilterRef.current = taskFilter
    fetchTasks()
  }, [taskFilter, fetchTasks])

  useEffect(() => {
    if (hasFetchedFamiliesRef.current) return
    hasFetchedFamiliesRef.current = true
    fetchFamilies()
  }, [fetchFamilies])

  useOrgChanged(useCallback(() => {
    invalidate()
    fetchedTaskFilterRef.current = null
    hasFetchedFamiliesRef.current = false
    setTasks([])
    setFamilies([])
    setLoadingTasks(true)
    fetchedTaskFilterRef.current = taskFilter
    fetchTasks()
    fetchFamilies()
  }, [taskFilter, fetchTasks, fetchFamilies, invalidate]))

  const completeTask = async (taskId: string) => {
    // Optimistic UI: mark complete right away, roll back on failure.
    const prev = tasks
    setTasks((cur) => cur.map((t) => (t._id === taskId ? { ...t, status: 'completed' as const } : t)))
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) throw new Error()
      invalidateCache(/^\/api\/tasks/)
      toast.success('Task completed.')
    } catch {
      setTasks(prev)
      toast.error('Could not complete task.')
    }
  }

  const deleteTask = async (task: Task) => {
    if (
      !(await confirm({
        title: 'Delete task?',
        message: `“${task.title}” will be permanently removed.`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    )
      return
    try {
      const res = await fetch(`/api/tasks/${task._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      invalidateCache(/^\/api\/tasks/)
      fetchTasks()
      toast.success('Task deleted.')
    } catch {
      toast.error('Could not delete task.')
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Tasks"
          subtitle="Manage your tasks and reminders."
          actions={
            <Button leftIcon={<PlusIcon className="h-5 w-5" />} onClick={() => setShowTaskModal(true)}>
              Add Task
            </Button>
          }
        />

        <div className="surface-card rounded-2xl shadow-xl p-4 sm:p-6 mb-6 border border-border">
          <div className="mb-4">
            <Tabs
              items={[
                { id: 'all', label: 'All Tasks' },
                { id: 'pending', label: 'Pending' },
                { id: 'today', label: 'Due Today' },
                { id: 'overdue', label: 'Overdue' },
              ]}
              activeId={taskFilter}
              onChange={(id) => setTaskFilter(id as any)}
              label="Task filters"
            />
          </div>

          {/* Tasks List */}
          {loadingTasks ? (
            <SkeletonRows count={5} />
          ) : tasksError ? (
            <EmptyState
              icon={<ExclamationTriangleIcon />}
              title="Couldn't load tasks"
              description="Try again in a moment."
              cta={{ label: 'Retry', onClick: () => fetchTasks() }}
            />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={<ClipboardDocumentListIcon />}
              title={taskFilter === 'all' ? 'No tasks yet' : 'Nothing here'}
              description={
                taskFilter === 'all'
                  ? 'Create your first task to track follow-ups and deadlines.'
                  : 'Try switching the filter or create a new task.'
              }
              cta={{
                label: 'Add Task',
                onClick: () => setShowTaskModal(true),
                icon: <PlusIcon className="h-4 w-4" />,
              }}
            />
          ) : (
            <ul className="space-y-3">
              {tasks.map((task) => {
                const dueDate = new Date(task.dueDate)
                const dueValid = Number.isFinite(dueDate.getTime())
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                const isOverdue = dueValid && dueDate < today && task.status !== 'completed'
                const isDueToday = dueValid && dueDate.toDateString() === today.toDateString()

                const priorityColors = {
                  low: 'bg-fg/5 text-fg',
                  medium: 'bg-accent/10 text-accent',
                  high: 'bg-orange-100 text-orange-800',
                  urgent: 'bg-red-100 text-red-800',
                }

                const statusColors = {
                  pending: 'bg-yellow-100 text-yellow-800',
                  in_progress: 'bg-accent/10 text-accent',
                  completed: 'bg-green-100 text-green-800',
                  cancelled: 'bg-fg/5 text-fg',
                }

                return (
                  <li
                    key={task._id}
                    className={`glass rounded-xl p-4 border border-border hover:border-white/40 transition-all ${
                      isOverdue ? 'border-red-300 bg-red-50/50' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <h3 className="font-semibold text-fg break-words">{task.title}</h3>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${priorityColors[task.priority]}`}>
                            {task.priority}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[task.status]}`}>
                            {task.status.replace('_', ' ')}
                          </span>
                          {isDueToday && task.status !== 'completed' && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800 flex items-center gap-1">
                              <ClockIcon className="h-3 w-3" aria-hidden="true" />
                              Due Today
                            </span>
                          )}
                          {isOverdue && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 flex items-center gap-1">
                              <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                              Overdue
                            </span>
                          )}
                        </div>
                        {task.description && <p className="text-sm text-fg mb-2">{task.description}</p>}
                        <div className="flex items-center gap-x-4 gap-y-1 text-xs text-fg-muted flex-wrap">
                          <span>Due: {formatLocaleDate(task.dueDate)}</span>
                          <span>Email: {task.email}</span>
                          {task.relatedFamilyId && <span>Family: {task.relatedFamilyId.name}</span>}
                          {task.relatedMemberId && (
                            <span>
                              Member: {task.relatedMemberId.firstName} {task.relatedMemberId.lastName}
                            </span>
                          )}
                          {task.emailSent && <span className="text-green-700">✓ Email Sent</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 self-end sm:self-start">
                        {task.status !== 'completed' && (
                          <button
                            onClick={() => completeTask(task._id)}
                            aria-label={`Mark ${task.title} as completed`}
                            title="Mark as completed"
                            className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-green-700 hover:bg-green-50 transition-colors"
                          >
                            <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteTask(task)}
                          aria-label={`Delete ${task.title}`}
                          title="Delete task"
                          className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-red-700 hover:bg-red-50 transition-colors"
                        >
                          <TrashIcon className="h-5 w-5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <TaskFormModal
        open={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        families={families}
        onCreated={fetchTasks}
      />
    </div>
  )
}
