'use client'

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { useColumnVisibility } from '@/lib/client/useColumnVisibility'
import {
  useDataFilters,
  filterDataRows,
  type ColumnFilterConfig,
  type FilterableColumn,
} from '@/lib/client/useDataFilters'
import {
  reactNodeToText,
  todayStamp,
  type ExportColumn,
} from '@/lib/client/export'
import type { ColumnPickerEntry } from './ColumnPicker'
import type { FilterPopoverColumn } from './FilterPopover'
import FilterChips from './FilterChips'
import type { ImportType } from '@/lib/import-templates'

// Toolbar surfaces — only rendered when the user enables them or opens a
// popover. Code-split each one so its popover body (filter UI, picker UI,
// menu UI) doesn't bloat the initial bundle on every page that uses a list.
const ColumnPicker = dynamic(() => import('./ColumnPicker'), {
  ssr: false,
  loading: () => null,
})
const FilterPopover = dynamic(() => import('./FilterPopover'), {
  ssr: false,
  loading: () => null,
})
const ExportMenu = dynamic(() => import('./ExportMenu'), {
  ssr: false,
  loading: () => null,
})
const ImportMenu = dynamic(() => import('./ImportMenu'), {
  ssr: false,
  loading: () => null,
})
const ImportModal = dynamic(() => import('./ImportModal'), {
  ssr: false,
  loading: () => null,
})

// Client-side CSV/XLSX exporters; XLSX already lazy-imports exceljs internally,
// but keeping the helpers behind a dynamic import lets the CSV-only path stay
// out of the initial bundle until the user clicks Export.
const loadExportHelpers = () => import('@/lib/client/export')

export interface DataColumn<T> {
  /** Stable key. Used as React key and also as sort key when `sortable` is true. */
  id: string
  /** Visible header label. */
  header: ReactNode
  /** Plain-text label for the column picker / export header when `header` is JSX. */
  headerText?: string
  /** Render the cell for one row. */
  cell: (row: T, index: number) => ReactNode
  /** Value used for CSV/XLSX export. Falls back to text extracted from `cell()`. */
  exportValue?: (row: T, index: number) => string | number | Date | null | undefined | boolean
  /** Hidden by default until the user toggles it on from the column picker. */
  defaultHidden?: boolean
  /** Column never renders on screen — only appears in exports. */
  exportOnly?: boolean
  /** Make the column header a sortable button (delegates to onSortChange). */
  sortable?: boolean
  /** Optional className applied to the <td>. */
  className?: string
  /** Hide this column under the given Tailwind breakpoint (eg "md"). */
  hideBelow?: 'sm' | 'md' | 'lg'
  /** Header text-alignment. */
  align?: 'left' | 'right' | 'center'
  /**
   * Declare that this column should be filterable in the DataView toolbar.
   * The DataView extracts the value (via `filter.getValue`, else `exportValue`,
   * else plain text of `cell`) and applies the matching predicate.
   */
  filter?: ColumnFilterConfig<T>
}

export type SortDir = 'asc' | 'desc'

export interface ToolbarConfig {
  columns?: boolean
  export?: boolean
  /** Custom toolbar nodes rendered to the right of the column picker / export menu. */
  right?: ReactNode
  /** Custom toolbar nodes rendered to the left of the column picker. */
  left?: ReactNode
}

export interface DataViewProps<T> {
  columns: DataColumn<T>[]
  rows: T[]
  /** Function returning a stable React key for a row. */
  rowKey: (row: T, index: number) => string
  /** Optional click handler — wraps each row in a button-like surface. */
  onRowClick?: (row: T, index: number) => void
  /** Render a row as a card on mobile. Required when columns contain rich content. */
  mobileCard: (row: T, index: number) => ReactNode
  /** Active sort state — when provided, header buttons get aria-sort. */
  sort?: { id: string; dir: SortDir } | null
  /** Called when a sortable header is activated. */
  onSortChange?: (id: string, dir: SortDir) => void
  /**
   * Tailwind breakpoint at which to switch to the table layout. Default 'md'.
   * Pass `'never'` to use the responsive card list at every breakpoint (handy
   * for rich expandable rows that don't fit a table cleanly).
   */
  tableFrom?: 'sm' | 'md' | 'lg' | 'never'
  /** Optional className on the wrapping element. */
  className?: string
  /** Replacement element when `rows` is empty. Usually an <EmptyState>. */
  empty?: ReactNode
  /** Stable key for localStorage column-visibility persistence + default filename. */
  tableId?: string
  /**
   * Rows to export. Defaults to the DataView's internally filtered rows
   * (so search + per-column filters carry over to the export). Pass an
   * explicit array to override (eg. parent does its own filtering).
   */
  exportRows?: T[]
  /** Base filename for exports. Defaults to `${tableId}-${YYYY-MM-DD}`. */
  exportFileName?: string
  /**
   * Optional hook for list views that paginate server-side. When the user
   * exports while more pages remain, this loads the full row set first;
   * the export then applies the active search / column filters.
   */
  expandExportRows?: () => Promise<T[] | void>
  /** Toolbar visibility & extras. Set to `false` to disable the toolbar entirely. */
  toolbar?: ToolbarConfig | false
  /**
   * Enable a global search input in the toolbar. `true` searches across the
   * text of every column. Pass an object to customize the placeholder or
   * provide a custom value-extractor (eg. include hidden fields).
   */
  globalSearch?: boolean | { placeholder?: string; getValue?: (row: T) => string }
  /** Notified whenever the internally filtered row set changes. */
  onFilteredRowsChange?: (rows: T[]) => void
  /**
   * Enable built-in pagination. Number = initial page size. Pass an object
   * to also control the `sizes` dropdown options (eg `[10, 25, 50, 100]`).
   * Pagination always operates on the FILTERED set, so search / per-column
   * filters reset to page 1 automatically.
   */
  pageSize?: number | { initial?: number; sizes?: number[] }
  /**
   * Opt-in CSV / XLSX import action. When provided, an Import dropdown
   * appears in the toolbar (Download template / Upload file…). The Upload
   * action opens an in-page modal that posts to `/api/import` and calls
   * `onImported` on success so the parent can refetch rows.
   *
   * When `familyId` is set, the import is bound to that family server-side:
   * every imported row is attached to it and the template drops the
   * familyName / familyEmail columns. `memberId` further scopes the binding
   * to a specific member (only meaningful for payments / lifecycle-events).
   */
  import?: {
    type: ImportType
    onImported?: () => void
    familyId?: string
    memberId?: string
  }
}

/**
 * Responsive list: table from `tableFrom` breakpoint up, card list below.
 *
 * - Table headers can be sortable via keyboard (Enter/Space).
 * - Aria-sort is wired so screen readers know the active sort.
 * - Toolbar (top-right) hosts global search, per-column filters, a
 *   column picker, and a CSV/Excel export menu.
 */
export function DataView<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  mobileCard,
  sort = null,
  onSortChange,
  tableFrom = 'md',
  className = '',
  empty,
  tableId,
  exportRows,
  exportFileName,
  expandExportRows,
  toolbar,
  globalSearch,
  onFilteredRowsChange,
  pageSize,
  import: importCfg,
}: DataViewProps<T>) {
  const paginationCfg = useMemo(() => {
    if (pageSize == null) return null
    if (typeof pageSize === 'number') return { initial: pageSize, sizes: defaultSizesFor(pageSize) }
    return {
      initial: pageSize.initial ?? pageSize.sizes?.[0] ?? 10,
      sizes: pageSize.sizes ?? defaultSizesFor(pageSize.initial ?? 10),
    }
  }, [pageSize])

  const [page, setPage] = useState(1)
  const [size, setSize] = useState(paginationCfg?.initial ?? 10)
  const [importOpen, setImportOpen] = useState(false)
  const toolbarEnabled = toolbar !== false
  const toolbarCfg: ToolbarConfig = toolbar === false ? {} : toolbar || {}
  const showColumns = toolbarEnabled && toolbarCfg.columns !== false
  const showExport = toolbarEnabled && toolbarCfg.export !== false

  const {
    visibility,
    isVisible,
    setVisible,
    showAll,
    reset,
    visibleCount,
    order,
    moveColumn,
  } = useColumnVisibility(tableId, columns)

  // Columns sorted according to the user's saved order. Built once per
  // (columns, order) change so the picker, headers, cells, and exports all
  // see the exact same sequence.
  const orderedColumns = useMemo(() => {
    if (!order || order.length === 0) return columns
    const byId = new Map(columns.map((c) => [c.id, c]))
    const seen = new Set<string>()
    const out: DataColumn<T>[] = []
    for (const id of order) {
      const col = byId.get(id)
      if (col && !seen.has(id)) {
        seen.add(id)
        out.push(col)
      }
    }
    // Append any columns the saved order doesn't know about (newly-added).
    for (const col of columns) {
      if (!seen.has(col.id)) out.push(col)
    }
    return out
  }, [columns, order])

  // Filtering. The hook only cares about columns + rows; it's safe to call
  // even when no column declares a filter and globalSearch is off.
  const filterableForHook = useMemo<FilterableColumn<T>[]>(
    () =>
      orderedColumns.map((c) => ({
        id: c.id,
        filter: c.filter,
        exportValue: c.exportValue,
        cell: c.cell,
        headerText: c.headerText,
        header: c.header,
      })),
    [orderedColumns],
  )

  const filters = useDataFilters<T>(filterableForHook, rows, { globalSearch })

  // Notify parent of filter changes (debounced via effect to avoid render storms).
  useEffect(() => {
    if (onFilteredRowsChange) onFilteredRowsChange(filters.filteredRows)
  }, [filters.filteredRows, onFilteredRowsChange])

  const pickerEntries: ColumnPickerEntry[] = useMemo(
    () =>
      orderedColumns
        .filter((c) => !c.exportOnly)
        .map((c) => ({
          id: c.id,
          label: c.headerText || (typeof c.header === 'string' ? c.header : c.id),
          visible: isVisible(c.id),
        })),
    [orderedColumns, visibility], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const filterColumns = useMemo<FilterPopoverColumn[]>(
    () =>
      orderedColumns
        .filter((c) => !!c.filter)
        .map((c) => ({
          id: c.id,
          label: c.filter?.label || c.headerText || (typeof c.header === 'string' ? c.header : c.id),
          config: c.filter as ColumnFilterConfig<any>,
          options: filters.optionsByColumn[c.id],
        })),
    [orderedColumns, filters.optionsByColumn],
  )

  // Columns that render on screen (skip exportOnly + hidden by user).
  const renderColumns = useMemo(
    () => orderedColumns.filter((c) => !c.exportOnly && isVisible(c.id)),
    [orderedColumns, visibility], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Reset to page 1 whenever the filter set changes (search, per-column, or
  // upstream row list itself).
  useEffect(() => {
    if (paginationCfg) setPage(1)
  }, [filters.search, filters.columnFilters, rows, paginationCfg])

  // Filtered (full) set vs. the slice actually shown on screen.
  const filteredAll = filters.filteredRows
  const totalRows = filteredAll.length
  const totalPages = paginationCfg ? Math.max(1, Math.ceil(totalRows / size)) : 1
  const safePage = Math.min(page, totalPages)
  const displayRows = paginationCfg
    ? filteredAll.slice((safePage - 1) * size, safePage * size)
    : filteredAll

  // Export defaults to the FULL filtered set (so a download isn't capped at
  // the current page). Parent can still override via exportRows.
  const exportSet = exportRows ?? filteredAll
  const exportCols: ExportColumn<T>[] = useMemo(
    () =>
      orderedColumns.map((col): ExportColumn<T> => {
        const label = col.headerText || (typeof col.header === 'string' ? col.header : col.id)
        return {
          id: col.id,
          label,
          value: (row: T) => {
            if (col.exportValue) {
              const v = col.exportValue(row, 0)
              return v ?? ''
            }
            try {
              return reactNodeToText(col.cell(row, 0))
            } catch {
              return ''
            }
          },
        }
      }),
    [orderedColumns],
  )

  const filenameBase = exportFileName || `${tableId || 'export'}-${todayStamp()}`

  const resolveExportSet = useCallback(async (): Promise<T[]> => {
    if (exportRows) return exportRows
    let base = rows
    if (expandExportRows) {
      const expanded = await expandExportRows()
      if (expanded && expanded.length > 0) base = expanded
    }
    return filterDataRows(base, filterableForHook, filters.search, filters.columnFilters, {
      globalSearch,
      filterableColumns: filterableForHook.filter((c) => !!c.filter),
    })
  }, [
    exportRows,
    rows,
    expandExportRows,
    filterableForHook,
    filters.search,
    filters.columnFilters,
    globalSearch,
  ])

  const handleCsv = useCallback(async () => {
    const { exportToCsv } = await loadExportHelpers()
    exportToCsv(filenameBase, exportCols, await resolveExportSet())
  }, [filenameBase, exportCols, resolveExportSet])

  const handleXlsx = useCallback(async () => {
    const { exportToXlsx } = await loadExportHelpers()
    await exportToXlsx(filenameBase, exportCols, await resolveExportSet())
  }, [filenameBase, exportCols, resolveExportSet])

  const showSearch = !!globalSearch && toolbarEnabled
  const showFilters = filterColumns.length > 0 && toolbarEnabled
  const showImport = !!importCfg && toolbarEnabled

  const hasToolbar =
    toolbarEnabled &&
    (showSearch ||
      showFilters ||
      showColumns ||
      showExport ||
      showImport ||
      toolbarCfg.left ||
      toolbarCfg.right)

  const searchPlaceholder =
    typeof globalSearch === 'object' && globalSearch?.placeholder
      ? globalSearch.placeholder
      : 'Search…'

  const mobileToolbarTouch =
    'max-md:[&_button]:inline-flex max-md:[&_button]:min-h-[var(--touch-target)] max-md:[&_button]:min-w-[var(--touch-target)] max-md:[&_button]:items-center max-md:[&_button]:justify-center'

  const renderToolbar = () =>
    hasToolbar ? (
      <div className={`mb-2 flex flex-wrap items-center gap-2 ${mobileToolbarTouch}`}>
        {toolbarCfg.left}
        {showSearch && (
          <SearchInput
            value={filters.search}
            onChange={filters.setSearch}
            placeholder={searchPlaceholder}
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {showFilters && (
            <FilterPopover
              columns={filterColumns}
              values={filters.columnFilters}
              onChange={filters.setColumnFilter}
              onClearAll={filters.clearAll}
              activeCount={filters.activeCount}
            />
          )}
          {showColumns && pickerEntries.length > 0 && (
            <ColumnPicker
              columns={pickerEntries}
              onChange={setVisible}
              onShowAll={showAll}
              onReset={reset}
              onMove={moveColumn}
              visibleCount={visibleCount}
            />
          )}
          {showExport && (
            <ExportMenu
              rowCount={exportSet.length}
              onExportCsv={handleCsv}
              onExportXlsx={handleXlsx}
            />
          )}
          {showImport && importCfg && (
            <ImportMenu
              type={importCfg.type}
              boundToFamily={!!importCfg.familyId}
              onUpload={() => setImportOpen(true)}
            />
          )}
          {toolbarCfg.right}
        </div>
      </div>
    ) : null

  const filterSummary =
    filters.activeCount > 0
      ? // Compare the filtered total (across all pages) to the
        // unfiltered total. Previously `displayRows.length` was used,
        // which is only the current page slice — so a filter that
        // matched 300 rows looked like "20 of 1000" instead of
        // "300 of 1000".
        `${totalRows.toLocaleString()} of ${rows.length.toLocaleString()} ${
          rows.length === 1 ? 'row' : 'rows'
        }`
      : undefined

  const chips =
    filters.activeFilters.length > 0 ? (
      <div className={mobileToolbarTouch}>
        <FilterChips
          filters={filters.activeFilters}
          onClearAll={filters.clearAll}
          summary={filterSummary}
        />
      </div>
    ) : null

  const footer = paginationCfg ? (
    <PaginationFooter
      page={safePage}
      pageSize={size}
      totalRows={totalRows}
      totalPages={totalPages}
      sizes={paginationCfg.sizes}
      onPageChange={setPage}
      onSizeChange={(s) => {
        setSize(s)
        setPage(1)
      }}
    />
  ) : null

  const renderImportModal = () =>
    importCfg ? (
      <ImportModal
        open={importOpen}
        type={importCfg.type}
        familyId={importCfg.familyId}
        memberId={importCfg.memberId}
        onClose={() => setImportOpen(false)}
        onImported={() => importCfg.onImported?.()}
      />
    ) : null

  if (filteredAll.length === 0 && empty) {
    return (
      <div className={className}>
        {renderToolbar()}
        {chips}
        {empty}
        {renderImportModal()}
      </div>
    )
  }

  const tableVisible =
    tableFrom === 'never'
      ? 'hidden'
      : tableFrom === 'sm'
      ? 'hidden sm:block'
      : tableFrom === 'lg'
      ? 'hidden lg:block'
      : 'hidden md:block'
  const cardVisible =
    tableFrom === 'never'
      ? 'block'
      : tableFrom === 'sm'
      ? 'sm:hidden'
      : tableFrom === 'lg'
      ? 'lg:hidden'
      : 'md:hidden'

  // Virtualize when the list isn't paginated and grows past this many rows.
  // Below the threshold the cost of measuring + windowing isn't worth the
  // savings, and the DOM is small enough to render in full.
  const VIRTUALIZE_THRESHOLD = 100
  const shouldVirtualize = !paginationCfg && displayRows.length > VIRTUALIZE_THRESHOLD

  return (
    <div className={className}>
      {renderToolbar()}
      {chips}

      {/* Mobile: card list */}
      {shouldVirtualize ? (
        <VirtualCardList
          className={cardVisible}
          rows={displayRows}
          rowKey={rowKey}
          onRowClick={onRowClick}
          mobileCard={mobileCard}
        />
      ) : (
        <ul className={`${cardVisible} flex flex-col gap-3`}>
          {displayRows.map((row, i) => (
            <li key={rowKey(row, i)}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row, i)}
                  className="focus-ring w-full text-left [&_.surface-card]:transition-colors [&_.surface-card]:hover:bg-fg/[0.02] [&_.surface-card]:active:bg-fg/[0.04]"
                >
                  {mobileCard(row, i)}
                </button>
              ) : (
                mobileCard(row, i)
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Mobile pagination footer (cards) */}
      {footer && <div className={`${cardVisible} mt-3`}>{footer}</div>}

      {/* Desktop: table */}
      <div className={`${tableVisible} surface-card overflow-x-auto`}>
        {shouldVirtualize ? (
          <VirtualTable
            rows={displayRows}
            rowKey={rowKey}
            columns={renderColumns}
            sort={sort}
            onSortChange={onSortChange}
            onRowClick={onRowClick}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-app-subtle text-left text-[11px] uppercase tracking-wider text-muted-on-subtle">
              <tr>
                {renderColumns.map((col) => (
                  <th
                    key={col.id}
                    scope="col"
                    className={`px-4 py-2.5 font-medium ${alignClass(col.align)} ${hideClass(col.hideBelow)}`}
                    aria-sort={
                      col.sortable && sort?.id === col.id
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : col.sortable
                        ? 'none'
                        : undefined
                    }
                  >
                    {col.sortable && onSortChange ? (
                      <SortableHeader
                        id={col.id}
                        header={col.header}
                        sort={sort}
                        onSortChange={onSortChange}
                      />
                    ) : (
                      col.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                  className={`border-t border-border ${
                    onRowClick ? 'cursor-pointer hover:bg-fg/[0.03]' : ''
                  }`}
                >
                  {renderColumns.map((col) => (
                    <td
                      key={col.id}
                      className={`px-4 py-2.5 align-middle text-fg ${alignClass(col.align)} ${hideClass(col.hideBelow)} ${col.className || ''}`}
                    >
                      {col.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {footer && <div className="border-t border-border">{footer}</div>}
      </div>
      {renderImportModal()}
    </div>
  )
}

/**
 * Virtualized table body — used by <DataView> when the visible row set is
 * large enough that mounting every <tr> would be wasteful. Renders only the
 * rows that intersect the scroll viewport, plus a small overscan window.
 * Uses absolute-positioned rows inside a `position: relative` tbody whose
 * height matches the full virtualized list — this preserves table layout
 * for the visible rows while letting the browser only paint a few dozen
 * <tr> elements regardless of total list size.
 */
function VirtualTable<T>({
  rows,
  rowKey,
  columns,
  sort,
  onSortChange,
  onRowClick,
}: {
  rows: T[]
  rowKey: (row: T, index: number) => string
  columns: DataColumn<T>[]
  sort: { id: string; dir: SortDir } | null
  onSortChange?: (id: string, dir: SortDir) => void
  onRowClick?: (row: T, index: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()

  return (
    <div
      ref={scrollRef}
      className="relative max-h-[70vh] overflow-y-auto"
      role="region"
      aria-label="Scrollable table"
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-border bg-app-subtle text-left text-[11px] uppercase tracking-wider text-muted-on-subtle">
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={`px-4 py-2.5 font-medium ${alignClass(col.align)} ${hideClass(col.hideBelow)}`}
                aria-sort={
                  col.sortable && sort?.id === col.id
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : col.sortable
                    ? 'none'
                    : undefined
                }
              >
                {col.sortable && onSortChange ? (
                  <SortableHeader
                    id={col.id}
                    header={col.header}
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ height: `${total}px`, position: 'relative', display: 'block' }}>
          {items.map((vi) => {
            const row = rows[vi.index]
            return (
              <tr
                key={rowKey(row, vi.index)}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                onClick={onRowClick ? () => onRowClick(row, vi.index) : undefined}
                className={`border-t border-border ${
                  onRowClick ? 'cursor-pointer hover:bg-fg/[0.03]' : ''
                }`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  display: 'table',
                  tableLayout: 'fixed',
                }}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={`px-4 py-2.5 align-middle text-fg ${alignClass(col.align)} ${hideClass(col.hideBelow)} ${col.className || ''}`}
                  >
                    {col.cell(row, vi.index)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Virtualized card list for the mobile layout — same idea as VirtualTable
 * but on a vertical `<ul>` of cards.
 */
function VirtualCardList<T>({
  className,
  rows,
  rowKey,
  onRowClick,
  mobileCard,
}: {
  className: string
  rows: T[]
  rowKey: (row: T, index: number) => string
  onRowClick?: (row: T, index: number) => void
  mobileCard: (row: T, index: number) => ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 112,
    overscan: 8,
  })
  const items = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()

  return (
    <div
      ref={scrollRef}
      className={`${className} max-h-[70vh] overflow-y-auto`}
      role="region"
      aria-label="Scrollable list"
    >
      <ul style={{ height: `${total}px`, position: 'relative' }}>
        {items.map((vi) => {
          const row = rows[vi.index]
          return (
            <li
              key={rowKey(row, vi.index)}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 12,
              }}
            >
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row, vi.index)}
                  className="focus-ring w-full text-left"
                >
                  {mobileCard(row, vi.index)}
                </button>
              ) : (
                mobileCard(row, vi.index)
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function defaultSizesFor(initial: number): number[] {
  const candidates = [10, 25, 50, 100, 250]
  const set = new Set([...candidates, initial])
  return Array.from(set).sort((a, b) => a - b)
}

function alignClass(a?: 'left' | 'right' | 'center') {
  return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'
}
function hideClass(h?: 'sm' | 'md' | 'lg') {
  if (!h) return ''
  return h === 'sm' ? 'hidden sm:table-cell' : h === 'md' ? 'hidden md:table-cell' : 'hidden lg:table-cell'
}

function SortableHeader({
  id,
  header,
  sort,
  onSortChange,
}: {
  id: string
  header: ReactNode
  sort: { id: string; dir: SortDir } | null
  onSortChange: (id: string, dir: SortDir) => void
}) {
  const active = sort?.id === id
  const dir = active ? sort!.dir : null
  return (
    <button
      type="button"
      onClick={() => onSortChange(id, active && dir === 'asc' ? 'desc' : 'asc')}
      className="focus-ring inline-flex items-center gap-1 font-medium uppercase tracking-wider text-fg-muted hover:text-fg"
    >
      {header}
      <SortIcon dir={dir} />
    </button>
  )
}

function SortIcon({ dir }: { dir: SortDir | null }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3 5l3-3 3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        opacity={dir === 'asc' ? 1 : 0.35}
      />
      <path
        d="M3 7l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        opacity={dir === 'desc' ? 1 : 0.35}
      />
    </svg>
  )
}

function PaginationFooter({
  page,
  pageSize,
  totalRows,
  totalPages,
  sizes,
  onPageChange,
  onSizeChange,
}: {
  page: number
  pageSize: number
  totalRows: number
  totalPages: number
  sizes: number[]
  onPageChange: (p: number) => void
  onSizeChange: (s: number) => void
}) {
  const startItem = totalRows === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalRows)
  const pages = getPageNumbers(page, totalPages)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-fg-muted">
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="font-medium text-fg tabular">{startItem}</span> –{' '}
          <span className="font-medium text-fg tabular">{endItem}</span> of{' '}
          <span className="font-medium text-fg tabular">{totalRows.toLocaleString()}</span>
        </span>
        {sizes.length > 1 && (
          <label className="hidden items-center gap-1.5 sm:inline-flex">
            <span className="text-fg-muted">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onSizeChange(Number(e.target.value))}
              className="focus-ring rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-fg hover:bg-fg/5"
              aria-label="Rows per page"
            >
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <nav className="inline-flex items-center gap-0.5" aria-label="Pagination">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e-${i}`} className="px-1 text-fg-subtle">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p as number)}
              aria-current={p === page ? 'page' : undefined}
              className={`focus-ring inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md px-2 text-xs font-medium tabular ${
                p === page
                  ? 'bg-accent text-white'
                  : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </nav>
    </div>
  )
}

function getPageNumbers(current: number, total: number): (number | '…')[] {
  const max = 7
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  if (current > 3) out.push('…')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) out.push(i)
  if (current < total - 2) out.push('…')
  out.push(total)
  return out
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  // Local mirror so typing isn't gated by parent re-renders.
  const [local, setLocal] = useState(value)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Sync when external value resets (e.g. Clear all).
  useEffect(() => {
    setLocal(value)
  }, [value])
  return (
    <div className="relative w-full max-w-xs">
      <MagnifyingGlassIcon
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value)
          onChange(e.target.value)
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="focus-ring min-h-[var(--touch-target)] w-full rounded-md border border-border bg-surface py-2.5 pl-8 pr-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent md:min-h-0 md:py-1.5"
      />
    </div>
  )
}
