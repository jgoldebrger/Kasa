import type { DataColumn } from '@/app/components/ui'

const MEMBER_HIDDEN_COLUMN_IDS = new Set(['select', 'plan', 'balance', 'actions'])

/** Admin list shows select/plan/balance/actions; members get a read-only column set. */
export function filterFamiliesListColumns<T>(
  columns: DataColumn<T>[],
  isAdmin: boolean,
): DataColumn<T>[] {
  if (isAdmin) return columns
  return columns.filter((column) => !MEMBER_HIDDEN_COLUMN_IDS.has(column.id))
}
