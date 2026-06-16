/** Page size for the global /tasks list (server prefetch + client pagination). */
export const TASKS_LIST_PAGE_SIZE = 50

export type TasksListPage = {
  items: unknown[]
  nextCursor: string | null
}

export function parseTasksListResponse(data: unknown): TasksListPage {
  if (data && typeof data === 'object' && Array.isArray((data as TasksListPage).items)) {
    const page = data as TasksListPage
    return { items: page.items, nextCursor: page.nextCursor ?? null }
  }
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null }
  }
  return { items: [], nextCursor: null }
}

export function tasksListUrl(
  cursor: string | null | undefined,
  limit = TASKS_LIST_PAGE_SIZE,
  filterQuery = '',
): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const base = `/api/tasks?${params.toString()}`
  if (!filterQuery) return base
  const extra = filterQuery.startsWith('?') ? filterQuery.slice(1) : filterQuery
  return `${base}&${extra}`
}
