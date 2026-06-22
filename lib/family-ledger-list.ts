import { z } from 'zod'
import { paginationLimit } from '@/lib/schemas'
import { UNBOUNDED_LIST_CAP } from '@/lib/schemas/common'
import {
  compoundCursorFilter,
  decodeCompoundCursor,
  encodeCompoundCursor,
  collectCompoundCursorPages,
  type CompoundCursor,
} from '@/lib/pagination'

import { FAMILY_LEDGER_DEFAULT_LIMIT } from '@/lib/family-ledger-constants'

export { FAMILY_LEDGER_DEFAULT_LIMIT }

export const familyLedgerListQuery = z.object({
  limit: paginationLimit,
  cursor: z.string().min(1).max(400).optional(),
})

export type FamilyLedgerListQuery = z.infer<typeof familyLedgerListQuery>

export type LedgerCursorEncoder = (last: Record<string, unknown>) => CompoundCursor

/**
 * Paginated or legacy-unbounded list for a family ledger collection.
 * When `limit` is provided, returns `{ items, nextCursor }`; otherwise
 * returns a flat array capped at UNBOUNDED_LIST_CAP.
 */
export async function listFamilyLedger<T extends { _id: unknown }>(
  baseFilter: Record<string, unknown>,
  loadPage: (filter: Record<string, unknown>, limit: number) => Promise<T[]>,
  sortField: string,
  direction: -1 | 1,
  encodeCursor: LedgerCursorEncoder,
  query: FamilyLedgerListQuery,
): Promise<T[] | { items: T[]; nextCursor: string | null }> {
  let filter = { ...baseFilter }

  if (query.cursor) {
    const c = decodeCompoundCursor(query.cursor)
    if (!c) {
      throw new Error('Invalid cursor')
    }
    const cursorValue =
      c.v === null ? null : sortField.endsWith('Date') ? new Date(c.v as number) : c.v
    Object.assign(filter, compoundCursorFilter(sortField, cursorValue, c.id, direction))
  }

  const clientLimit = query.limit ?? 0
  const effectiveLimit = clientLimit > 0 ? clientLimit : UNBOUNDED_LIST_CAP

  if (clientLimit > 0) {
    const rows = await loadPage(filter, effectiveLimit + 1)
    let items = rows
    let nextCursor: string | null = null
    if (rows.length > effectiveLimit) {
      items = rows.slice(0, effectiveLimit)
      const last = items[items.length - 1]
      if (last) nextCursor = encodeCompoundCursor(encodeCursor(last))
    }
    return { items, nextCursor }
  }

  return (await collectCompoundCursorPages(
    loadPage,
    filter,
    sortField,
    direction,
    encodeCursor,
  )) as T[]
}
