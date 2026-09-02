import type { ReactNode } from 'react'
import { reactNodeToText } from '@/lib/client/export'

export type SortDir = 'asc' | 'desc'

export type SortState = { id: string; dir: SortDir } | null

type SortableColumn<T> = {
  id: string
  sortable?: boolean
  exportValue?: (row: T, index: number) => string | number | Date | null | undefined | boolean
  cell: (row: T, index: number) => ReactNode
}

const NON_SORTABLE_IDS = new Set(['actions', 'select'])

export function columnIsSortable<T>(col: SortableColumn<T>): boolean {
  if (col.sortable === false) return false
  if (col.sortable === true) return true
  if (NON_SORTABLE_IDS.has(col.id)) return false
  return !!col.exportValue
}

function getSortValue<T>(col: SortableColumn<T>, row: T, index: number): unknown {
  if (col.exportValue) return col.exportValue(row, index)
  try {
    return reactNodeToText(col.cell(row, index))
  } catch {
    return ''
  }
}

function compareSortValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime()
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b)
  }

  return String(a).toLowerCase().localeCompare(String(b).toLowerCase())
}

export function sortDataRows<T>(rows: T[], sort: SortState, columns: SortableColumn<T>[]): T[] {
  if (!sort) return rows
  const column = columns.find((col) => col.id === sort.id && columnIsSortable(col))
  if (!column) return rows

  const mult = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort(
    (a, b) => mult * compareSortValues(getSortValue(column, a, 0), getSortValue(column, b, 0)),
  )
}
