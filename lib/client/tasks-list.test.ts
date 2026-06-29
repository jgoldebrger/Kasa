import { describe, it, expect } from 'vitest'
import { TASKS_LIST_PAGE_SIZE, parseTasksListResponse, tasksListUrl } from './tasks-list'

describe('tasks-list client helpers', () => {
  it('parseTasksListResponse accepts legacy arrays and paginated envelopes', () => {
    expect(parseTasksListResponse([{ _id: '1' }])).toEqual({
      items: [{ _id: '1' }],
      nextCursor: null,
    })
    expect(parseTasksListResponse({ items: [{ _id: '2' }], nextCursor: 'abc' })).toEqual({
      items: [{ _id: '2' }],
      nextCursor: 'abc',
    })
    expect(parseTasksListResponse({ error: 'nope' })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('tasksListUrl builds limit, cursor, and filter query params', () => {
    expect(tasksListUrl(null)).toBe(`/api/tasks?limit=${TASKS_LIST_PAGE_SIZE}`)
    expect(tasksListUrl('cursor-token', 25)).toBe('/api/tasks?limit=25&cursor=cursor-token')
    expect(tasksListUrl(null, TASKS_LIST_PAGE_SIZE, 'status=pending')).toBe(
      `/api/tasks?limit=${TASKS_LIST_PAGE_SIZE}&status=pending`,
    )
    expect(tasksListUrl(null, TASKS_LIST_PAGE_SIZE, 'assignedToMe=true')).toBe(
      `/api/tasks?limit=${TASKS_LIST_PAGE_SIZE}&assignedToMe=true`,
    )
  })
})
