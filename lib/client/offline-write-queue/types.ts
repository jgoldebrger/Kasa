export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

/** v1 queued mutation types — lightweight, idempotent-ish updates only. */
export type QueuedOperationType = 'task-status-update' | 'task-notes-update'

export interface TaskStatusPayload {
  taskId: string
  status: TaskStatus
}

export interface TaskNotesPayload {
  taskId: string
  notes: string
}

export type QueuedOperationPayload = TaskStatusPayload | TaskNotesPayload

export interface QueuedOperation {
  id: string
  type: QueuedOperationType
  organizationId: string
  createdAt: number
  payload: QueuedOperationPayload
}

export type OfflineQueueSpec =
  | { type: 'task-status-update'; taskId: string; status: TaskStatus }
  | { type: 'task-notes-update'; taskId: string; notes: string }
