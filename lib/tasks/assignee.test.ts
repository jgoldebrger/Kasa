import { describe, expect, it } from 'vitest'
import { assignedToMeFilter } from './assignee'

describe('assignedToMeFilter', () => {
  it('matches assigneeUserId and legacy email-only tasks', () => {
    const filter = assignedToMeFilter('user-123', 'Admin@Example.com')
    expect(filter).toEqual({
      $or: [
        { assigneeUserId: 'user-123' },
        {
          email: 'admin@example.com',
          $or: [{ assigneeUserId: null }, { assigneeUserId: { $exists: false } }],
        },
      ],
    })
  })

  it('omits legacy email branch when user email is empty', () => {
    expect(assignedToMeFilter('user-123', '')).toEqual({
      $or: [{ assigneeUserId: 'user-123' }],
    })
  })
})
