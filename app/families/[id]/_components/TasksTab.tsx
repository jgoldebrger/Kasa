// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import {
  PlusIcon,
  TrashIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { Badge, Button, Card, EmptyState, SkeletonRows } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

const PRIORITY_BADGE: Record<string, 'muted' | 'accent' | 'warning' | 'danger'> = {
  low: 'muted',
  medium: 'accent',
  high: 'warning',
  urgent: 'danger',
}

const STATUS_BADGE: Record<string, 'warning' | 'accent' | 'success' | 'muted'> = {
  pending: 'warning',
  in_progress: 'accent',
  completed: 'success',
  cancelled: 'muted',
}

function TasksTabContent(props: FamilyDetailContextValue) {
  const {
    familyTasks,
    loadingFamilyTasks,
    setShowTaskModal,
    completeFamilyTask,
    deleteFamilyTask,
  } = props

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-fg">Tasks</h3>
        <Button
          size="sm"
          leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setShowTaskModal(true)}
        >
          Add Task
        </Button>
      </div>
      {loadingFamilyTasks ? (
        <SkeletonRows count={4} />
      ) : familyTasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardDocumentListIcon className="h-8 w-8 text-fg-muted" />}
          title="No tasks yet"
          description="Create a task to track follow-ups or reminders for this family."
          cta={{
            label: 'Add Task',
            onClick: () => setShowTaskModal(true),
            icon: <PlusIcon className="h-4 w-4" />,
          }}
        />
      ) : (
        <ul className="space-y-3">
          {familyTasks.map((task) => {
            const dueDate = new Date(task.dueDate)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const isOverdue = dueDate < today && task.status !== 'completed'
            const isDueToday = dueDate.toDateString() === today.toDateString()

            return (
              <li key={task._id}>
                <Card compact className={isOverdue ? 'border-danger/30 bg-danger/5' : undefined}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h4 className="break-words font-semibold text-fg">{task.title}</h4>
                        <Badge variant={PRIORITY_BADGE[task.priority] || 'muted'}>
                          {task.priority}
                        </Badge>
                        <Badge variant={STATUS_BADGE[task.status] || 'muted'}>
                          {String(task.status).replace('_', ' ')}
                        </Badge>
                        {isDueToday && task.status !== 'completed' && (
                          <Badge variant="warning" className="normal-case">
                            <ClockIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                            Due Today
                          </Badge>
                        )}
                        {isOverdue && (
                          <Badge variant="danger" className="normal-case">
                            <ExclamationTriangleIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                            Overdue
                          </Badge>
                        )}
                      </div>
                      {task.description && (
                        <p className="mb-2 text-sm text-fg-muted">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                        <span>Due: {dueDate.toLocaleDateString()}</span>
                        <span>Email: {task.email}</span>
                        {task.relatedMemberId && (
                          <span>
                            Member: {task.relatedMemberId.firstName} {task.relatedMemberId.lastName}
                          </span>
                        )}
                        {task.emailSent && <span className="text-success">✓ Email Sent</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 self-end sm:self-start">
                      {task.status !== 'completed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => completeFamilyTask(task._id)}
                          aria-label={`Mark ${task.title} as completed`}
                          title="Mark as completed"
                          className="text-success hover:text-success"
                        >
                          <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteFamilyTask(task)}
                        aria-label={`Delete ${task.title}`}
                        title="Delete task"
                        className="text-danger hover:text-danger"
                      >
                        <TrashIcon className="h-5 w-5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function TasksTab() {
  const ctx = useFamilyDetail()
  return <TasksTabContent {...ctx} />
}
