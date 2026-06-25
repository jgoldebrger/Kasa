import { UNBOUNDED_LIST_CAP } from '@/lib/schemas/common'

/** Page size for the global /tasks list (server prefetch + client pagination). */
export const TASKS_LIST_PAGE_SIZE = 50

export type TasksListPage<T = Record<string, unknown>> = {
  items: T[]
  nextCursor: string | null
}

export function parseTasksListResponse<T = Record<string, unknown>>(
  data: unknown,
): TasksListPage<T> {
  if (data && typeof data === 'object' && Array.isArray((data as TasksListPage<T>).items)) {
    const page = data as TasksListPage<T>
    return { items: page.items, nextCursor: page.nextCursor ?? null }
  }
  if (Array.isArray(data)) {
    return { items: data as T[], nextCursor: null }
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

/**
 * Walk cursor pages until every task row is collected. Caps iterations so
 * a malformed cursor chain cannot loop forever.
 */
export async function collectAllTasksPages<T = Record<string, unknown>>(
  fetchPage: (cursor: string | null) => Promise<TasksListPage<T>>,
  pageSize = TASKS_LIST_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  const maxPages = Math.ceil(UNBOUNDED_LIST_CAP / pageSize) + 50
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor)
    out.push(...page.items)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return out
}
