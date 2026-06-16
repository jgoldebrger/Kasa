import { describe, it, expect } from 'vitest'
import {
  EVENTS_LIST_PAGE_SIZE,
  eventsListUrl,
  parseEventsListResponse,
} from './events-list'

describe('events-list client helpers', () => {
  it('parseEventsListResponse accepts legacy arrays and paginated envelopes', () => {
    expect(parseEventsListResponse([{ _id: '1' }])).toEqual({
      items: [{ _id: '1' }],
      nextCursor: null,
    })
    expect(
      parseEventsListResponse({ items: [{ _id: '2' }], nextCursor: 'abc' }),
    ).toEqual({
      items: [{ _id: '2' }],
      nextCursor: 'abc',
    })
    expect(parseEventsListResponse({ error: 'nope' })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('eventsListUrl builds limit and cursor query params', () => {
    expect(eventsListUrl(null)).toBe(`/api/events?limit=${EVENTS_LIST_PAGE_SIZE}`)
    expect(eventsListUrl('cursor-token', 25)).toBe('/api/events?limit=25&cursor=cursor-token')
  })
})
