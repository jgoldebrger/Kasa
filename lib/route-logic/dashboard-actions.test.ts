import { describe, it, expect } from 'vitest'
import {
  OPEN_TASK_STATUSES,
  UPCOMING_EVENTS_DAYS,
  upcomingEventsDateRange,
  mapTaskAttentionItem,
  buildAttentionSection,
} from './dashboard-actions'

describe('dashboard-actions aggregation', () => {
  it('OPEN_TASK_STATUSES includes pending and in_progress only', () => {
    expect(OPEN_TASK_STATUSES).toEqual(['pending', 'in_progress'])
  })

  it('upcomingEventsDateRange spans 60 calendar days from today in UTC', () => {
    const ref = new Date('2026-06-15T15:00:00.000Z')
    const { from, toExclusive } = upcomingEventsDateRange('UTC', UPCOMING_EVENTS_DAYS, ref)
    expect(from.toISOString()).toBe('2026-06-15T00:00:00.000Z')
    expect(toExclusive.toISOString()).toBe('2026-08-15T00:00:00.000Z')
  })

  it('mapTaskAttentionItem normalizes _id to string', () => {
    const item = mapTaskAttentionItem({
      _id: 'abc123',
      title: 'Follow up',
      dueDate: '2026-06-10',
      status: 'pending',
      priority: 'high',
    })
    expect(item).toEqual({
      _id: 'abc123',
      title: 'Follow up',
      dueDate: '2026-06-10',
      status: 'pending',
      priority: 'high',
    })
  })

  it('buildAttentionSection caps items while preserving total count', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    expect(buildAttentionSection(12, items, 3)).toEqual({
      count: 12,
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })
  })
})
