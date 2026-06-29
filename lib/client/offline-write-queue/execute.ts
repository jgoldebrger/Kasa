import type { QueuedOperation } from './types'

export interface ExecuteRequest {
  url: string
  method: string
  body: Record<string, unknown>
}

/** Map a queued operation to the API route it replays on sync. */
export function operationToRequest(op: QueuedOperation): ExecuteRequest {
  switch (op.type) {
    case 'task-status-update': {
      const { taskId, status } = op.payload as { taskId: string; status: string }
      return {
        url: `/api/tasks/${taskId}`,
        method: 'PUT',
        body: { status },
      }
    }
    case 'task-notes-update': {
      const { taskId, notes } = op.payload as { taskId: string; notes: string }
      return {
        url: `/api/tasks/${taskId}`,
        method: 'PUT',
        body: { notes },
      }
    }
    default: {
      const _exhaustive: never = op.type
      throw new Error(`Unknown queued operation type: ${_exhaustive}`)
    }
  }
}

/** HTTP statuses that mean the queued change is stale — drop it after toast. */
export function isSyncConflictStatus(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 422
}

/** Transient failures — stop the batch and retry on next reconnect. */
export function isSyncRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}
