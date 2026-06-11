'use client'

/**
 * useDataFilters — generic, declarative filtering for <DataView>.
 *
 * Pages just declare per-column filter configs on their `DataColumn`s; this
 * hook owns the filter state and produces the filtered row set. The DataView
 * surfaces a toolbar (search input + Filters button + active-filter chips)
 * that calls into the API returned here.
 *
 * Design choices:
 *  - Filters are *in-memory only* (no URL or server persistence). They are
 *    transient by nature; persisting hidden filters can produce confusing
 *    "where are my rows?" bugs.
 *  - Comparisons use string-extracted text where possible so columns whose
 *    cells return JSX still filter correctly (matches what `exportValue` does).
 */

import { useCallback, useMemo, useState } from 'react'
import { reactNodeToText } from '@/lib/client/export'

export type FilterType =
  | 'text'
  | 'select'
  | 'multiselect'
  | 'number'
  | 'numberRange'
  | 'date'
  | 'dateRange'
  | 'boolean'

export interface FilterOption {
  value: string
  label: string
}

export interface ColumnFilterConfig<T> {
  type: FilterType
  /** Value getter used for filtering. Falls back to `exportValue` then to plain-text of `cell()`. */
  getValue?: (row: T) => string | number | Date | boolean | null | undefined
  /** Predefined options for `select` / `multiselect`. When omitted, options are auto-extracted from rows. */
  options?: FilterOption[]
  /** Placeholder for the filter input. */
  placeholder?: string
  /** Override for the label shown in the popover / chip. Defaults to the column's `headerText` / `header`. */
  label?: string
  /** Soft cap on auto-extracted options. Defaults to 100. */
  maxAutoOptions?: number
}

/** Internal column descriptor — what the hook needs to know about a column. */
export interface FilterableColumn<T> {
  id: string
  filter?: ColumnFilterConfig<T>
  exportValue?: (row: T, index: number) => string | number | Date | null | undefined | boolean
  cell: (row: T, index: number) => unknown
  headerText?: string
  header?: unknown
}

/** Per-column filter value. Discriminated by FilterType. */
export type FilterValue =
  | { type: 'text'; value: string }
  | { type: 'select'; value: string }
  | { type: 'multiselect'; value: string[] }
  | { type: 'number'; value: number | null }
  | { type: 'numberRange'; min: number | null; max: number | null }
  | { type: 'date'; value: string | null } // ISO YYYY-MM-DD
  | { type: 'dateRange'; from: string | null; to: string | null }
  | { type: 'boolean'; value: boolean | null }

export interface ActiveFilter {
  id: string
  label: string
  display: string
  clear: () => void
}

export interface DataFiltersApi<T> {
  /** Rows after global search + per-column filters have been applied. */
  filteredRows: T[]
  /** Plain global-search query. */
  search: string
  setSearch: (q: string) => void
  /** Map of columnId → current filter value (only set columns are present). */
  columnFilters: Record<string, FilterValue>
  setColumnFilter: (id: string, v: FilterValue | null) => void
  /** Reset everything (search + all column filters). */
  clearAll: () => void
  /** UI-friendly list of currently active filters, for the chip strip. */
  activeFilters: ActiveFilter[]
  /** Total count of active filters (including the global search if non-empty). */
  activeCount: number
  /** Auto-extracted distinct options keyed by columnId, for select/multiselect inputs. */
  optionsByColumn: Record<string, FilterOption[]>
  /** Whether any column declares a filter or globalSearch is on. Used by DataView to know whether to show the toolbar. */
  hasAnyFilterable: boolean
}

interface UseDataFiltersOptions<T> {
  globalSearch?: boolean | { placeholder?: string; getValue?: (row: T) => string }
}

/* ───────────────────────── helpers ─────────────────────────── */

function getRowText<T>(row: T, col: FilterableColumn<T>): string {
  if (col.filter?.getValue) {
    return rawToText(col.filter.getValue(row))
  }
  if (col.exportValue) {
    return rawToText(col.exportValue(row, 0))
  }
  try {
    return reactNodeToText(col.cell(row, 0) as any)
  } catch {
    return ''
  }
}

function getRowValue<T>(
  row: T,
  col: FilterableColumn<T>,
): string | number | Date | boolean | null | undefined {
  if (col.filter?.getValue) return col.filter.getValue(row)
  if (col.exportValue) return col.exportValue(row, 0)
  try {
    return reactNodeToText(col.cell(row, 0) as any)
  } catch {
    return ''
  }
}

function rawToText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString()
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toDateMs(v: unknown): number | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime()
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.getTime()
}

function dateOnlyMs(iso: string | null, endOfDay: boolean): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  if (endOfDay) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function colLabel<T>(col: FilterableColumn<T>): string {
  return (
    col.filter?.label ||
    col.headerText ||
    (typeof col.header === 'string' ? (col.header as string) : col.id)
  )
}

function matchValue<T>(value: ReturnType<typeof getRowValue<T>>, filter: FilterValue): boolean {
  switch (filter.type) {
    case 'text': {
      const needle = filter.value.trim().toLowerCase()
      if (!needle) return true
      return rawToText(value).toLowerCase().includes(needle)
    }
    case 'select': {
      if (!filter.value) return true
      return rawToText(value) === filter.value
    }
    case 'multiselect': {
      if (filter.value.length === 0) return true
      return filter.value.includes(rawToText(value))
    }
    case 'number': {
      if (filter.value == null) return true
      const n = toNumber(value)
      return n != null && n === filter.value
    }
    case 'numberRange': {
      if (filter.min == null && filter.max == null) return true
      const n = toNumber(value)
      if (n == null) return false
      if (filter.min != null && n < filter.min) return false
      if (filter.max != null && n > filter.max) return false
      return true
    }
    case 'date': {
      if (!filter.value) return true
      const wanted = dateOnlyMs(filter.value, false)
      const got = toDateMs(value)
      if (wanted == null || got == null) return false
      const d = new Date(got)
      d.setHours(0, 0, 0, 0)
      return d.getTime() === wanted
    }
    case 'dateRange': {
      if (!filter.from && !filter.to) return true
      const got = toDateMs(value)
      if (got == null) return false
      const from = dateOnlyMs(filter.from, false)
      const to = dateOnlyMs(filter.to, true)
      if (from != null && got < from) return false
      if (to != null && got > to) return false
      return true
    }
    case 'boolean': {
      if (filter.value == null) return true
      const v = value
      if (typeof v === 'boolean') return v === filter.value
      const t = rawToText(v).toLowerCase()
      if (filter.value === true) return ['true', '1', 'yes', 'y'].includes(t)
      return ['false', '0', 'no', 'n', ''].includes(t)
    }
    default:
      return true
  }
}

function displayValue(filter: FilterValue): string {
  switch (filter.type) {
    case 'text':
      return `"${filter.value}"`
    case 'select':
      return filter.value
    case 'multiselect':
      return filter.value.length <= 2
        ? filter.value.join(', ')
        : `${filter.value.slice(0, 2).join(', ')} +${filter.value.length - 2}`
    case 'number':
      return filter.value == null ? '' : String(filter.value)
    case 'numberRange': {
      if (filter.min != null && filter.max != null) return `${filter.min} – ${filter.max}`
      if (filter.min != null) return `≥ ${filter.min}`
      if (filter.max != null) return `≤ ${filter.max}`
      return ''
    }
    case 'date':
      return filter.value || ''
    case 'dateRange': {
      if (filter.from && filter.to) return `${filter.from} → ${filter.to}`
      if (filter.from) return `from ${filter.from}`
      if (filter.to) return `to ${filter.to}`
      return ''
    }
    case 'boolean':
      return filter.value == null ? '' : filter.value ? 'Yes' : 'No'
    default:
      return ''
  }
}

function isEmpty(filter: FilterValue): boolean {
  switch (filter.type) {
    case 'text':
      return filter.value.trim() === ''
    case 'select':
      return !filter.value
    case 'multiselect':
      return filter.value.length === 0
    case 'number':
      return filter.value == null
    case 'numberRange':
      return filter.min == null && filter.max == null
    case 'date':
      return !filter.value
    case 'dateRange':
      return !filter.from && !filter.to
    case 'boolean':
      return filter.value == null
    default:
      return true
  }
}

/** Apply the current DataView search + column filters to an arbitrary row set. */
export function filterDataRows<T>(
  rows: T[],
  columns: FilterableColumn<T>[],
  search: string,
  columnFilters: Record<string, FilterValue>,
  opts: {
    globalSearch?: boolean | { placeholder?: string; getValue?: (row: T) => string }
    filterableColumns?: FilterableColumn<T>[]
    globalGetText?: ((row: T) => string) | null
  } = {},
): T[] {
  const filterableColumns = opts.filterableColumns ?? columns.filter((c) => !!c.filter)
  const needle = search.trim().toLowerCase()
  const colEntries = Object.entries(columnFilters)
  if (!needle && colEntries.length === 0) return rows

  let globalGetText = opts.globalGetText ?? null
  if (globalGetText == null && opts.globalSearch) {
    if (typeof opts.globalSearch === 'object' && opts.globalSearch.getValue) {
      const fn = opts.globalSearch.getValue
      globalGetText = (row) => fn(row)
    } else {
      globalGetText = (row) => columns.map((c) => getRowText(row, c)).join(' \u0001 ')
    }
  }

  return rows.filter((row) => {
    if (needle && globalGetText) {
      if (!globalGetText(row).toLowerCase().includes(needle)) return false
    }
    for (const [colId, filter] of colEntries) {
      const col = filterableColumns.find((c) => c.id === colId)
      if (!col) continue
      if (!matchValue(getRowValue(row, col), filter)) return false
    }
    return true
  })
}

/* ───────────────────────── the hook ─────────────────────────── */

export function useDataFilters<T>(
  columns: FilterableColumn<T>[],
  rows: T[],
  opts: UseDataFiltersOptions<T> = {},
): DataFiltersApi<T> {
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFiltersState] = useState<Record<string, FilterValue>>({})

  const filterableColumns = useMemo(() => columns.filter((c) => !!c.filter), [columns])
  const globalSearchEnabled = !!opts.globalSearch
  const hasAnyFilterable = globalSearchEnabled || filterableColumns.length > 0

  // Auto-extracted select options.
  const optionsByColumn = useMemo<Record<string, FilterOption[]>>(() => {
    const out: Record<string, FilterOption[]> = {}
    for (const col of filterableColumns) {
      const f = col.filter!
      if (f.type !== 'select' && f.type !== 'multiselect') continue
      if (f.options && f.options.length > 0) {
        out[col.id] = f.options
        continue
      }
      const max = f.maxAutoOptions ?? 100
      const seen = new Map<string, string>()
      for (const row of rows) {
        if (seen.size >= max) break
        const v = getRowValue(row, col)
        if (v == null || v === '') continue
        const key = rawToText(v)
        if (!seen.has(key)) seen.set(key, key)
      }
      out[col.id] = Array.from(seen.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    return out
  }, [filterableColumns, rows])

  const setColumnFilter = useCallback((id: string, v: FilterValue | null) => {
    setColumnFiltersState((prev) => {
      const next = { ...prev }
      if (v == null || isEmpty(v)) {
        if (!(id in next)) return prev
        delete next[id]
        return next
      }
      next[id] = v
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setSearch('')
    setColumnFiltersState({})
  }, [])

  // Build the global-search getter once.
  const globalGetText = useMemo<((row: T) => string) | null>(() => {
    if (!globalSearchEnabled) return null
    if (typeof opts.globalSearch === 'object' && opts.globalSearch?.getValue) {
      const fn = opts.globalSearch.getValue
      return (row) => fn(row)
    }
    // Default: concatenate text of all columns (skip exportOnly is handled by DataView upstream).
    return (row) => columns.map((c) => getRowText(row, c)).join(' \u0001 ')
  }, [globalSearchEnabled, opts.globalSearch, columns])

  const filteredRows = useMemo<T[]>(
    () =>
      filterDataRows(rows, columns, search, columnFilters, {
        globalSearch: opts.globalSearch,
        filterableColumns,
        globalGetText,
      }),
    [rows, search, columnFilters, filterableColumns, globalGetText, columns, opts.globalSearch],
  )

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const out: ActiveFilter[] = []
    if (search.trim()) {
      out.push({
        id: '__search__',
        label: 'Search',
        display: `"${search.trim()}"`,
        clear: () => setSearch(''),
      })
    }
    for (const [colId, filter] of Object.entries(columnFilters)) {
      const col = filterableColumns.find((c) => c.id === colId)
      if (!col) continue
      out.push({
        id: colId,
        label: colLabel(col),
        display: displayValue(filter),
        clear: () => setColumnFilter(colId, null),
      })
    }
    return out
  }, [search, columnFilters, filterableColumns, setColumnFilter])

  return {
    filteredRows,
    search,
    setSearch,
    columnFilters,
    setColumnFilter,
    clearAll,
    activeFilters,
    activeCount: activeFilters.length,
    optionsByColumn,
    hasAnyFilterable,
  }
}

/** Vitest-only hooks for defensive branches that are unreachable via the hook API. */
export const useDataFiltersInternals =
  process.env.VITEST === 'true'
    ? { displayValue, isEmpty, matchValue, getRowText, getRowValue }
    : undefined
