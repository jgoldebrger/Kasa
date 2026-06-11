'use client'

/**
 * ColumnPicker — small popover anchored under a "Columns" button. Lets the
 * user:
 *   - Toggle which DataView columns are visible (checkboxes).
 *   - Reorder columns by drag-and-drop (or via the keyboard ↑/↓ buttons
 *     that appear on focus / hover for accessibility).
 *
 * Used internally by <DataView>; not exported to pages.
 *
 * - Click-outside dismiss
 * - Keyboard: Escape closes; checkboxes work natively; ↑/↓ buttons reorder.
 * - "Show all" + "Reset" actions
 * - At least one column must remain visible (delegated to useColumnVisibility)
 */

import { useEffect, useRef, useState } from 'react'
import {
  AdjustmentsHorizontalIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  Bars3Icon,
  CheckIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'

export interface ColumnPickerEntry {
  id: string
  label: string
  visible: boolean
}

interface Props {
  columns: ColumnPickerEntry[]
  onChange: (id: string, visible: boolean) => void
  onShowAll: () => void
  onReset: () => void
  /** Move a column from one position to another in the ordered list. */
  onMove: (from: number, to: number) => void
  /** Number of columns currently visible (to disable hiding the last one). */
  visibleCount: number
}

type DropEdge = 'above' | 'below'

export default function ColumnPicker({
  columns,
  onChange,
  onShowAll,
  onReset,
  onMove,
  visibleCount,
}: Props) {
  const [open, setOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // Where the cursor is currently hovering, and on which edge (above/below
  // the target's vertical midpoint). The blue indicator line is painted on
  // that edge — and the actual insertion index is derived from this.
  const [dropTarget, setDropTarget] = useState<{ index: number; edge: DropEdge } | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  // Drag state lives in refs too so async handlers see the latest values
  // without depending on a re-render race with the browser's drag events.
  const dragIndexRef = useRef<number | null>(null)
  const dropTargetRef = useRef<{ index: number; edge: DropEdge } | null>(null)

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

  // Reset drag state if the popover closes mid-drag.
  useEffect(() => {
    if (!open) {
      dragIndexRef.current = null
      dropTargetRef.current = null
      setDragIndex(null)
      setDropTarget(null)
    }
  }, [open])

  const resetDrag = () => {
    dragIndexRef.current = null
    dropTargetRef.current = null
    setDragIndex(null)
    setDropTarget(null)
  }

  const handleDragStart = (i: number) => (e: React.DragEvent<HTMLLIElement>) => {
    dragIndexRef.current = i
    setDragIndex(i)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(i))
    } catch {
      // some browsers throw outside of trusted gestures; ignore
    }
  }

  const handleDragOver = (i: number) => (e: React.DragEvent<HTMLLIElement>) => {
    if (dragIndexRef.current == null) return
    // ALWAYS preventDefault so the browser keeps treating us as a drop
    // target, even when hovering the dragged item itself.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    // Edge = above if cursor is in the top half of the target, else below.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const edge: DropEdge = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'

    const next = { index: i, edge }
    const prev = dropTargetRef.current
    if (!prev || prev.index !== next.index || prev.edge !== next.edge) {
      dropTargetRef.current = next
      setDropTarget(next)
    }
  }

  const handleDrop = () => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    const from = dragIndexRef.current
    const target = dropTargetRef.current
    if (from != null && target) {
      // Translate (target.index, edge) into an absolute insertion index in
      // the CURRENT array. Then convert that into the (from → to) call
      // shape that `onMove` expects (after splicing `from` out).
      let insertAt = target.edge === 'below' ? target.index + 1 : target.index
      if (insertAt > from) insertAt -= 1 // account for removing the source
      if (insertAt !== from) onMove(from, insertAt)
    }
    resetDrag()
  }

  const handleDragEnd = () => {
    resetDrag()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show / hide / reorder columns"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg"
      >
        <AdjustmentsHorizontalIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Columns</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Show, hide, or reorder columns"
          className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-md border border-border bg-surface shadow-popover"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Columns
            </p>
            <p className="mt-0.5 text-[11px] text-fg-subtle">
              Drag <Bars3Icon className="inline h-3 w-3 -mt-0.5" /> to reorder
            </p>
          </div>
          <ul
            className="max-h-72 overflow-y-auto py-1"
            // Catch dragover even when cursor is in the gaps between items,
            // so the browser keeps the drop allowed throughout the list.
            onDragOver={(e) => {
              if (dragIndexRef.current != null) e.preventDefault()
            }}
          >
            {columns.map((col, i) => {
              const isLastVisible = col.visible && visibleCount <= 1
              const isDragging = dragIndex === i
              const isDropAbove = dropTarget?.index === i && dropTarget.edge === 'above'
              const isDropBelow = dropTarget?.index === i && dropTarget.edge === 'below'
              return (
                <li
                  key={col.id}
                  draggable
                  onDragStart={handleDragStart(i)}
                  onDragEnter={(e) => {
                    if (dragIndexRef.current != null) e.preventDefault()
                  }}
                  onDragOver={handleDragOver(i)}
                  onDrop={handleDrop()}
                  onDragEnd={handleDragEnd}
                  className={`group relative flex items-center gap-1 px-2 py-1.5 text-sm text-fg ${
                    isDragging ? 'opacity-40' : 'hover:bg-fg/5'
                  }`}
                >
                  {/* Drop indicator — absolutely positioned so it does NOT
                      change the row height (otherwise the cursor slips off
                      the row mid-drag, especially when going downward). */}
                  {isDropAbove && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-1 top-0 h-0.5 -translate-y-1/2 rounded-full bg-accent"
                    />
                  )}
                  {isDropBelow && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 translate-y-1/2 rounded-full bg-accent"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="cursor-grab text-fg-subtle hover:text-fg-muted active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <Bars3Icon className="h-4 w-4" />
                  </span>
                  <label
                    className={`flex flex-1 items-center gap-2 ${
                      isLastVisible ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={col.visible}
                      disabled={isLastVisible}
                      onChange={(e) => onChange(col.id, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent"
                    />
                    <span className="truncate">{col.label}</span>
                  </label>
                  <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => i > 0 && onMove(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Move ${col.label} up`}
                      title="Move up"
                      className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUpIcon className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => i < columns.length - 1 && onMove(i, i + 1)}
                      disabled={i === columns.length - 1}
                      aria-label={`Move ${col.label} down`}
                      title="Move down"
                      className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDownIcon className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex border-t border-border bg-app-subtle">
            <button
              type="button"
              onClick={onShowAll}
              className="flex-1 px-3 py-2 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg flex items-center justify-center gap-1"
            >
              <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Show all
            </button>
            <button
              type="button"
              onClick={onReset}
              className="flex-1 border-l border-border px-3 py-2 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg flex items-center justify-center gap-1"
            >
              <EyeSlashIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
