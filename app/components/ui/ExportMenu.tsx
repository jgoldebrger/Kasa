'use client'

/**
 * ExportMenu — small popover anchored under a download icon button. Lets the
 * user export the current rows to CSV or Excel. Used internally by <DataView>.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownTrayIcon,
  DocumentTextIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline'

interface Props {
  onExportCsv: () => void
  onExportXlsx: () => Promise<void> | void
  disabled?: boolean
  /** Row count shown in the menu so users know what they're about to download. */
  rowCount: number
}

export default function ExportMenu({ onExportCsv, onExportXlsx, disabled, rowCount }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  const handleCsv = () => {
    setOpen(false)
    onExportCsv()
  }

  const handleXlsx = async () => {
    try {
      setBusy(true)
      await onExportXlsx()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const isDisabled = disabled || rowCount === 0

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !isDisabled && setOpen((o) => !o)}
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isDisabled ? 'Nothing to export' : 'Export'}
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Export</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-md border border-border bg-surface shadow-popover"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] font-medium text-fg-muted">
              {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'} to export
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleCsv}
            disabled={busy}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-fg/5 disabled:opacity-50"
          >
            <DocumentTextIcon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
            <div>
              <div>CSV</div>
              <div className="text-[11px] text-fg-muted">Comma-separated</div>
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleXlsx}
            disabled={busy}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-fg hover:bg-fg/5 disabled:opacity-50"
          >
            <TableCellsIcon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
            <div>
              <div>{busy ? 'Preparing…' : 'Excel (.xlsx)'}</div>
              <div className="text-[11px] text-fg-muted">Formatted spreadsheet</div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
