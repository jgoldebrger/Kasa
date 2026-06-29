import { invalidate as invalidateCache } from '@/lib/client-cache'
import { deleteOperation } from './db'
import { dispatchQueueChanged } from './events'
import { isSyncConflictStatus, isSyncRetryableStatus, operationToRequest } from './execute'
import { listPendingOperations } from './queue'
import { resolveActiveOrgId } from './org'

export interface SyncResult {
  synced: number
  conflicts: number
  stoppedEarly: boolean
}

export interface SyncCallbacks {
  onConflict?: (detail: string) => void
  onSynced?: (count: number) => void
}

let syncing = false

export function isOfflineQueueSyncing(): boolean {
  return syncing
}

/**
 * Replay pending mutations for the active org, oldest first.
 * Stops on auth failure, rate limits, or network errors so the
 * remainder can be retried on the next `online` event.
 */
export async function syncOfflineQueue(callbacks: SyncCallbacks = {}): Promise<SyncResult> {
  if (typeof window === 'undefined') return { synced: 0, conflicts: 0, stoppedEarly: false }
  if (!navigator.onLine) return { synced: 0, conflicts: 0, stoppedEarly: false }
  if (syncing) return { synced: 0, conflicts: 0, stoppedEarly: true }

  syncing = true
  let synced = 0
  let conflicts = 0
  let stoppedEarly = false
  let invalidatedTasks = false

  try {
    const orgId = await resolveActiveOrgId()
    if (!orgId) return { synced: 0, conflicts: 0, stoppedEarly: false }

    const pending = await listPendingOperations(orgId)

    for (const op of pending) {
      const { url, method, body } = operationToRequest(op)
      let res: Response
      try {
        res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        stoppedEarly = true
        break
      }

      if (res.ok) {
        await deleteOperation(op.id)
        synced += 1
        if (op.type === 'task-status-update' || op.type === 'task-notes-update') {
          invalidatedTasks = true
        }
        continue
      }

      if (res.status === 401 || res.status === 403) {
        stoppedEarly = true
        break
      }

      if (isSyncConflictStatus(res.status)) {
        await deleteOperation(op.id)
        conflicts += 1
        const errBody = await res.json().catch(() => ({}))
        const msg = typeof errBody?.error === 'string' ? errBody.error : undefined
        callbacks.onConflict?.(msg ?? op.type)
        continue
      }

      if (isSyncRetryableStatus(res.status)) {
        stoppedEarly = true
        break
      }

      // Unexpected 4xx — treat as conflict and drop.
      await deleteOperation(op.id)
      conflicts += 1
      callbacks.onConflict?.(op.type)
    }

    if (invalidatedTasks) {
      invalidateCache(/^\/api\/tasks/)
    }
    if (synced > 0) {
      dispatchQueueChanged()
      callbacks.onSynced?.(synced)
    } else if (conflicts > 0) {
      dispatchQueueChanged()
    }
  } finally {
    syncing = false
  }

  return { synced, conflicts, stoppedEarly }
}
