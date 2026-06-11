'use client'

/**
 * FilterChips — compact strip of pills representing the currently active
 * filters. Each chip shows `Label: value` with a close button that clears
 * just that filter. A trailing "Clear all" link clears everything.
 *
 * Rendered by <DataView> just below the toolbar when any filter is active.
 */

import { XMarkIcon } from '@heroicons/react/24/outline'
import type { ActiveFilter } from '@/lib/client/useDataFilters'

interface Props {
  filters: ActiveFilter[]
  onClearAll: () => void
  /** Optional row-count summary appended after the chips. */
  summary?: string
}

export default function FilterChips({ filters, onClearAll, summary }: Props) {
  if (filters.length === 0 && !summary) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
      {filters.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-fg"
        >
          <span className="text-fg-muted">{f.label}:</span>
          <span className="font-medium">{f.display}</span>
          <button
            type="button"
            onClick={f.clear}
            aria-label={`Clear ${f.label} filter`}
            className="focus-ring -mr-0.5 rounded p-0.5 text-fg-subtle hover:text-fg"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="focus-ring rounded px-1.5 py-0.5 text-xs font-medium text-accent hover:underline"
        >
          Clear all
        </button>
      )}
      {summary && <span className="ml-auto text-fg-subtle">{summary}</span>}
    </div>
  )
}
