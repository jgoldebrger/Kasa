/**
 * Compound-key cursor pagination helpers.
 *
 * Audit-log uses a bespoke `(createdAt, _id)` cursor that's safe under
 * collisions on the sort field. The other list endpoints used to encode
 * only `_id`, which silently skipped or duplicated rows whenever two
 * documents shared the same primary sort value (eg two payments on the
 * same `paymentDate`).
 *
 * Use `encodeCompoundCursor` / `decodeCompoundCursor` from any list
 * endpoint that needs to paginate over `(sortField, _id)` together.
 */

import { Types } from 'mongoose'
import { UNBOUNDED_LIST_CAP } from './schemas/common'

export interface CompoundCursor {
  /** The sort field value packed as a primitive (Date → epoch ms, etc.). */
  v: string | number | null
  id: string
}

export function encodeCompoundCursor(payload: CompoundCursor): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCompoundCursor(raw: string): CompoundCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!obj || typeof obj !== 'object') return null
    if (typeof obj.id !== 'string') return null
    if (!Types.ObjectId.isValid(obj.id)) return null
    // Whitelist `v` to primitive scalars only. Anything else (object,
    // array) would otherwise reach `compoundCursorFilter` and end up as
    // a Mongo operator (e.g. `{ [sortField]: { $ne: null } }`) — that's
    // NoSQL operator injection through a client-controlled cursor.
    const v = obj.v
    if (
      v !== null &&
      typeof v !== 'string' &&
      typeof v !== 'number'
    ) {
      return null
    }
    return { v, id: obj.id }
  } catch {
    return null
  }
}

/**
 * Build a Mongo filter to resume after a compound cursor.
 *
 * @param sortField  Mongo path for the primary sort key (eg "paymentDate").
 * @param cursorV    Value at which we left off (from `decodeCompoundCursor`).
 * @param cursorId   Last seen `_id`.
 * @param direction  -1 if the list sorts descending, 1 if ascending.
 */
export function compoundCursorFilter(
  sortField: string,
  cursorV: string | number | Date | null,
  cursorId: string,
  direction: -1 | 1,
): Record<string, unknown> {
  const op = direction === -1 ? '$lt' : '$gt'
  const idClause = { [op]: new Types.ObjectId(cursorId) }
  if (cursorV === null || cursorV === undefined) {
    return { _id: idClause }
  }
  // The $or branch carries forward the strict inequality on the sort
  // field, then falls back to the _id tiebreak when the sort values match.
  return {
    $or: [
      { [sortField]: { [op]: cursorV } },
      { [sortField]: cursorV, _id: idClause },
    ],
  }
}

/**
 * Walk a compound-cursor paginated list until every row is collected.
 * Used by legacy "return a flat array" endpoints that must not silently
 * stop at UNBOUNDED_LIST_CAP.
 */
export async function collectCompoundCursorPages<T extends { _id: unknown }>(
  loadPage: (filter: Record<string, unknown>, limit: number) => Promise<T[]>,
  baseFilter: Record<string, unknown>,
  sortField: string,
  direction: -1 | 1,
  getCursor: (last: T) => CompoundCursor,
  batchSize = UNBOUNDED_LIST_CAP,
): Promise<T[]> {
  const out: T[] = []
  let filter: Record<string, unknown> = { ...baseFilter }
  for (;;) {
    const page = await loadPage(filter, batchSize + 1)
    if (page.length === 0) break
    const hasMore = page.length > batchSize
    const batch = hasMore ? page.slice(0, batchSize) : page
    out.push(...batch)
    if (!hasMore) break
    const last = batch[batch.length - 1]
    const cursor = getCursor(last)
    filter = {
      ...baseFilter,
      ...compoundCursorFilter(sortField, cursor.v, cursor.id, direction),
    }
  }
  return out
}
