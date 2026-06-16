/** Page size for the global /events list (server prefetch + client pagination). */
export const EVENTS_LIST_PAGE_SIZE = 50

export type EventsListPage = {
  items: unknown[]
  nextCursor: string | null
}

export function parseEventsListResponse(data: unknown): EventsListPage {
  if (data && typeof data === 'object' && Array.isArray((data as EventsListPage).items)) {
    const page = data as EventsListPage
    return { items: page.items, nextCursor: page.nextCursor ?? null }
  }
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null }
  }
  return { items: [], nextCursor: null }
}

export function eventsListUrl(cursor: string | null | undefined, limit = EVENTS_LIST_PAGE_SIZE): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return `/api/events?${params.toString()}`
}
