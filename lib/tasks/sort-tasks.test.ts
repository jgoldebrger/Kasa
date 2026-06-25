import { describe, it, expect } from 'vitest'
import { sortTaskRows } from '@/lib/tasks/sort-tasks'

const rows = [
  {
    title: 'Beta task',
    dueDate: '2024-06-01',
    priority: 'high',
    status: 'pending',
    familyName: 'Beta Family',
    email: 'b@example.com',
  },
  {
    title: 'Alpha task',
    dueDate: '2024-01-15',
    priority: 'low',
    status: 'completed',
    familyName: 'Alpha Family',
    email: 'a@example.com',
  },
]

describe('sortTaskRows', () => {
  it('returns rows unchanged when sort is null', () => {
    expect(sortTaskRows(rows, null)).toEqual(rows)
  })

  it('sorts by due date descending', () => {
    const sorted = sortTaskRows(rows, { id: 'dueDate', dir: 'desc' })
    expect(sorted[0].title).toBe('Beta task')
  })

  it('sorts by title ascending', () => {
    const sorted = sortTaskRows(rows, { id: 'title', dir: 'asc' })
    expect(sorted[0].title).toBe('Alpha task')
  })

  it('sorts by priority ascending', () => {
    const sorted = sortTaskRows(rows, { id: 'priority', dir: 'asc' })
    expect(sorted[0].priority).toBe('low')
  })

  it('sorts by family name ascending', () => {
    const sorted = sortTaskRows(rows, { id: 'family', dir: 'asc' })
    expect(sorted[0].familyName).toBe('Alpha Family')
  })
})
