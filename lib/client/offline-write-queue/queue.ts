import { deleteOperation, getAllOperations, putOperation } from './db'
import { dispatchQueueChanged } from './events'
import { resolveActiveOrgId } from './org'
import type {
  OfflineQueueSpec,
  QueuedOperation,
  QueuedOperationPayload,
  QueuedOperationType,
} from './types'

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function payloadKey(type: QueuedOperationType, payload: QueuedOperationPayload): string {
  if (type === 'task-status-update' || type === 'task-notes-update') {
    return `${type}:${payload.taskId}`
  }
  return type
}

/** Drop any pending op of the same type targeting the same resource. */
async function coalescePending(
  organizationId: string,
  type: QueuedOperationType,
  payload: QueuedOperationPayload,
): Promise<void> {
  const key = payloadKey(type, payload)
  const all = await getAllOperations()
  const stale = all.filter(
    (op) => op.organizationId === organizationId && payloadKey(op.type, op.payload) === key,
  )
  await Promise.all(stale.map((op) => deleteOperation(op.id)))
}

export async function enqueueOperation(
  spec: OfflineQueueSpec,
  organizationId?: string | null,
): Promise<QueuedOperation> {
  const orgId = organizationId ?? (await resolveActiveOrgId())
  if (!orgId) {
    throw new Error('Cannot queue offline change without an active organization')
  }

  const payload =
    spec.type === 'task-status-update'
      ? { taskId: spec.taskId, status: spec.status }
      : { taskId: spec.taskId, notes: spec.notes }

  await coalescePending(orgId, spec.type, payload)

  const op: QueuedOperation = {
    id: newId(),
    type: spec.type,
    organizationId: orgId,
    createdAt: Date.now(),
    payload,
  }
  await putOperation(op)
  dispatchQueueChanged()
  return op
}

export async function countPendingOperations(organizationId?: string | null): Promise<number> {
  const orgId = organizationId ?? (await resolveActiveOrgId())
  if (!orgId) return 0
  const all = await getAllOperations()
  return all.filter((op) => op.organizationId === orgId).length
}

export async function listPendingOperations(
  organizationId?: string | null,
): Promise<QueuedOperation[]> {
  const orgId = organizationId ?? (await resolveActiveOrgId())
  if (!orgId) return []
  const all = await getAllOperations()
  return all.filter((op) => op.organizationId === orgId).sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeOperation(id: string): Promise<void> {
  await deleteOperation(id)
  dispatchQueueChanged()
}
