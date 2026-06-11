/**
 * Client helpers for the cursor-paginated GET /api/families endpoint.
 *
 * The UI loads one page at a time via `?limit=&cursor=`; export and other
 * "need everything" flows walk the cursor chain explicitly instead of
 * relying on the legacy unbounded array shape.
 */

import { UNBOUNDED_LIST_CAP } from '@/lib/schemas/common'

/** Default page size for the families list UI and SSR prefetch. */
export const FAMILIES_LIST_PAGE_SIZE = 50

export interface FamiliesListPage<T = Record<string, unknown>> {
  items: T[]
  nextCursor: string | null
}

/** Normalize either the paginated envelope or the legacy flat array. */
export function parseFamiliesListResponse<T = Record<string, unknown>>(
  data: unknown,
): FamiliesListPage<T> {
  if (Array.isArray(data)) {
    return { items: data as T[], nextCursor: null }
  }
  if (data && typeof data === 'object') {
    const obj = data as { items?: unknown; nextCursor?: unknown }
    if (Array.isArray(obj.items)) {
      return {
        items: obj.items as T[],
        nextCursor: typeof obj.nextCursor === 'string' ? obj.nextCursor : null,
      }
    }
  }
  return { items: [], nextCursor: null }
}

export function familiesListUrl(cursor: string | null | undefined, limit = FAMILIES_LIST_PAGE_SIZE): string {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (cursor) qs.set('cursor', cursor)
  return `/api/families?${qs.toString()}`
}

/**
 * Walk cursor pages until every family row is collected. Caps iterations so
 * a malformed cursor chain cannot loop forever.
 */
export async function collectAllFamiliesPages<T = Record<string, unknown>>(
  fetchPage: (cursor: string | null) => Promise<FamiliesListPage<T>>,
  pageSize = FAMILIES_LIST_PAGE_SIZE,
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
