/** Page size for the global /payments list (server prefetch + client pagination). */
export const PAYMENTS_LIST_PAGE_SIZE = 50

export type PaymentsListPage = {
  items: unknown[]
  nextCursor: string | null
}

export function parsePaymentsListResponse(data: unknown): PaymentsListPage {
  if (data && typeof data === 'object' && Array.isArray((data as PaymentsListPage).items)) {
    const page = data as PaymentsListPage
    return { items: page.items, nextCursor: page.nextCursor ?? null }
  }
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null }
  }
  return { items: [], nextCursor: null }
}
