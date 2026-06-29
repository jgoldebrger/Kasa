import { describe, expect, it } from 'vitest'
import { isSyncConflictStatus, isSyncRetryableStatus, operationToRequest } from './execute'
import type { QueuedOperation } from './types'

function op(type: QueuedOperation['type'], payload: QueuedOperation['payload']): QueuedOperation {
  return {
    id: 'test-id',
    type,
    organizationId: 'org-1',
    createdAt: 1,
    payload,
  }
}

describe('offline-write-queue execute', () => {
  it('maps task status updates to PUT /api/tasks/:id', () => {
    expect(
      operationToRequest(op('task-status-update', { taskId: 'abc', status: 'completed' })),
    ).toEqual({
      url: '/api/tasks/abc',
      method: 'PUT',
      body: { status: 'completed' },
    })
  })

  it('maps task notes updates to PUT /api/tasks/:id', () => {
    expect(
      operationToRequest(op('task-notes-update', { taskId: 'xyz', notes: 'call back' })),
    ).toEqual({
      url: '/api/tasks/xyz',
      method: 'PUT',
      body: { notes: 'call back' },
    })
  })

  it('classifies conflict and retryable HTTP statuses', () => {
    expect(isSyncConflictStatus(404)).toBe(true)
    expect(isSyncConflictStatus(409)).toBe(true)
    expect(isSyncConflictStatus(500)).toBe(false)
    expect(isSyncRetryableStatus(429)).toBe(true)
    expect(isSyncRetryableStatus(503)).toBe(true)
    expect(isSyncRetryableStatus(404)).toBe(false)
  })
})
