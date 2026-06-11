import { describe, expect, it } from 'vitest'
import { taskBody, taskUpdateBody } from './task'

const VALID_OID = '507f1f77bcf86cd799439011'

describe('task schemas', () => {
  describe('taskBody', () => {
    it('accepts a valid task payload', () => {
      const result = taskBody.safeParse({
        title: 'Follow up on payment',
        dueDate: '2025-07-01',
        email: 'assignee@example.com',
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional status, priority, and relations', () => {
      const result = taskBody.safeParse({
        title: 'Follow up',
        description: 'Call the family',
        dueDate: '2025-07-01',
        email: 'assignee@example.com',
        status: 'pending',
        priority: 'high',
        relatedFamilyId: VALID_OID,
        relatedMemberId: VALID_OID,
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing title', () => {
      const result = taskBody.safeParse({
        dueDate: '2025-07-01',
        email: 'assignee@example.com',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid assignee email', () => {
      const result = taskBody.safeParse({
        title: 'Task',
        dueDate: '2025-07-01',
        email: 'bad-email',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid status', () => {
      const result = taskBody.safeParse({
        title: 'Task',
        dueDate: '2025-07-01',
        email: 'assignee@example.com',
        status: 'open',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('taskUpdateBody', () => {
    it('accepts a partial update', () => {
      const result = taskUpdateBody.safeParse({
        status: 'completed',
      })
      expect(result.success).toBe(true)
    })

    it('accepts completedAt', () => {
      const result = taskUpdateBody.safeParse({
        completedAt: '2025-06-15',
      })
      expect(result.success).toBe(true)
    })

    it('accepts null completedAt', () => {
      const result = taskUpdateBody.safeParse({
        completedAt: null,
      })
      expect(result.success).toBe(true)
    })

    it('accepts an empty partial update', () => {
      const result = taskUpdateBody.safeParse({})
      expect(result.success).toBe(true)
    })
  })
})
