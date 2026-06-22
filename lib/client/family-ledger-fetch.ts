import { FAMILY_LEDGER_DEFAULT_LIMIT } from '@/lib/family-ledger-constants'

export type LedgerPage<T> = {
  items: T[]
  nextCursor: string | null
}

function isLedgerPage<T>(data: unknown): data is LedgerPage<T> {
  return (
    !!data &&
    typeof data === 'object' &&
    'items' in data &&
    Array.isArray((data as LedgerPage<T>).items)
  )
}

/** Unwrap paginated `{ items, nextCursor }` or legacy flat array responses. */
export function unwrapLedgerItems<T>(data: unknown): T[] {
  if (isLedgerPage<T>(data)) return data.items
  if (Array.isArray(data)) return data as T[]
  return []
}

export async function fetchFamilyLedgerPage<T>(
  url: string,
  opts?: { cursor?: string | null; limit?: number },
): Promise<LedgerPage<T>> {
  const limit = opts?.limit ?? FAMILY_LEDGER_DEFAULT_LIMIT
  const qs = new URLSearchParams({ limit: String(limit) })
  if (opts?.cursor) qs.set('cursor', opts.cursor)
  const res = await fetch(`${url}?${qs.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`)
  }
  const data = await res.json().catch(() => ({}))
  if (isLedgerPage<T>(data)) return data
  if (Array.isArray(data)) return { items: data as T[], nextCursor: null }
  return { items: [], nextCursor: null }
}
