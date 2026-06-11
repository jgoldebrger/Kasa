'use client'

/**
 * FilterPopover — popover anchored under a "Filters" button. Renders one
 * input per filter-enabled column. Used internally by <DataView>; not
 * intended for direct page use.
 *
 * - Click-outside dismiss + Escape closes.
 * - Per-column inputs are derived from the column's `filter.type`.
 * - A "Clear all" button at the bottom resets every active filter.
 */

import { useEffect, useRef, useState } from 'react'
import { FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type {
  ColumnFilterConfig,
  FilterOption,
  FilterValue,
} from '@/lib/client/useDataFilters'

export interface FilterPopoverColumn {
  id: string
  label: string
  config: ColumnFilterConfig<any>
  options?: FilterOption[]
}

interface Props {
  columns: FilterPopoverColumn[]
  values: Record<string, FilterValue>
  onChange: (id: string, value: FilterValue | null) => void
  onClearAll: () => void
  activeCount: number
}

export default function FilterPopover({
  columns,
  values,
  onChange,
  onClearAll,
  activeCount,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (columns.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Filter rows"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg"
      >
        <FunnelIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Filters</span>
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter rows"
          className="absolute right-0 top-full z-50 mt-2 w-[20rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-border bg-surface shadow-popover"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Filters
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="focus-ring rounded p-0.5 text-fg-subtle hover:text-fg"
              aria-label="Close"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-3 py-3 space-y-3">
            {columns.map((col) => (
              <FilterField
                key={col.id}
                col={col}
                value={values[col.id]}
                onChange={(v) => onChange(col.id, v)}
              />
            ))}
          </div>

          <div className="flex border-t border-border bg-app-subtle">
            <button
              type="button"
              onClick={onClearAll}
              disabled={activeCount === 0}
              className="flex-1 px-3 py-2 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 border-l border-border px-3 py-2 text-xs font-medium text-fg hover:bg-fg/5"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── per-type inputs ────────────────────── */

function FilterField({
  col,
  value,
  onChange,
}: {
  col: FilterPopoverColumn
  value: FilterValue | undefined
  onChange: (v: FilterValue | null) => void
}) {
  const t = col.config.type
  const inputCls =
    'focus-ring w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent'

  const label = (
    <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted">
      {col.label}
    </label>
  )

  if (t === 'text') {
    const v = value?.type === 'text' ? value.value : ''
    return (
      <div className="space-y-1">
        {label}
        <input
          type="text"
          placeholder={col.config.placeholder || 'Contains…'}
          value={v}
          onChange={(e) => onChange({ type: 'text', value: e.target.value })}
          className={inputCls}
        />
      </div>
    )
  }

  if (t === 'select') {
    const v = value?.type === 'select' ? value.value : ''
    const options = col.options || []
    return (
      <div className="space-y-1">
        {label}
        <select
          value={v}
          onChange={(e) =>
            onChange(e.target.value ? { type: 'select', value: e.target.value } : null)
          }
          className={inputCls}
        >
          <option value="">{col.config.placeholder || 'Any'}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (t === 'multiselect') {
    const v = value?.type === 'multiselect' ? value.value : []
    const options = col.options || []
    const toggle = (opt: string) => {
      const next = v.includes(opt) ? v.filter((x) => x !== opt) : [...v, opt]
      onChange({ type: 'multiselect', value: next })
    }
    return (
      <div className="space-y-1">
        {label}
        <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-surface px-2 py-1">
          {options.length === 0 ? (
            <p className="px-1 py-1 text-xs text-fg-subtle">No options</p>
          ) : (
            options.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-fg hover:bg-fg/5 rounded"
              >
                <input
                  type="checkbox"
                  checked={v.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent"
                />
                <span className="truncate">{opt.label}</span>
              </label>
            ))
          )}
        </div>
      </div>
    )
  }

  if (t === 'number') {
    const v = value?.type === 'number' ? value.value : null
    return (
      <div className="space-y-1">
        {label}
        <input
          type="number"
          placeholder={col.config.placeholder || 'Equals…'}
          value={v == null ? '' : v}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : { type: 'number', value: Number(e.target.value) },
            )
          }
          className={inputCls}
        />
      </div>
    )
  }

  if (t === 'numberRange') {
    const cur = value?.type === 'numberRange' ? value : null
    const min = cur?.min ?? null
    const max = cur?.max ?? null
    const update = (m: number | null, x: number | null) =>
      onChange(m == null && x == null ? null : { type: 'numberRange', min: m, max: x })
    return (
      <div className="space-y-1">
        {label}
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Min"
            value={min ?? ''}
            onChange={(e) => update(e.target.value === '' ? null : Number(e.target.value), max)}
            className={inputCls}
          />
          <span className="text-xs text-fg-muted">to</span>
          <input
            type="number"
            placeholder="Max"
            value={max ?? ''}
            onChange={(e) => update(min, e.target.value === '' ? null : Number(e.target.value))}
            className={inputCls}
          />
        </div>
      </div>
    )
  }

  if (t === 'date') {
    const v = value?.type === 'date' ? value.value || '' : ''
    return (
      <div className="space-y-1">
        {label}
        <input
          type="date"
          value={v}
          onChange={(e) =>
            onChange(e.target.value ? { type: 'date', value: e.target.value } : null)
          }
          className={inputCls}
        />
      </div>
    )
  }

  if (t === 'dateRange') {
    const cur = value?.type === 'dateRange' ? value : null
    const from = cur?.from ?? ''
    const to = cur?.to ?? ''
    const update = (f: string, x: string) =>
      onChange(
        !f && !x ? null : { type: 'dateRange', from: f || null, to: x || null },
      )
    return (
      <div className="space-y-1">
        {label}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => update(e.target.value, to)}
            className={inputCls}
            aria-label={`${col.label} from`}
          />
          <span className="text-xs text-fg-muted">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => update(from, e.target.value)}
            className={inputCls}
            aria-label={`${col.label} to`}
          />
        </div>
      </div>
    )
  }

  if (t === 'boolean') {
    const v = value?.type === 'boolean' ? value.value : null
    return (
      <div className="space-y-1">
        {label}
        <select
          value={v == null ? '' : v ? 'yes' : 'no'}
          onChange={(e) => {
            if (e.target.value === '') onChange(null)
            else onChange({ type: 'boolean', value: e.target.value === 'yes' })
          }}
          className={inputCls}
        >
          <option value="">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
    )
  }

  return null
}
