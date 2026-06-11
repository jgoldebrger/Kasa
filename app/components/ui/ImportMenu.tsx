'use client'

/**
 * ImportMenu — small popover anchored under an upload icon button. Lets the
 * user either grab the CSV template for the current data type or open the
 * upload modal. Used internally by <DataView> when `import` is configured.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpTrayIcon,
  DocumentArrowDownIcon,
  DocumentArrowUpIcon,
} from '@heroicons/react/24/outline'
import {
  downloadImportTemplate,
  IMPORT_LABELS,
  type ImportType,
} from '@/lib/import-templates'

interface Props {
  type: ImportType
  /** Opens the upload modal owned by DataView. */
  onUpload: () => void
  disabled?: boolean
  /**
   * When true, the downloaded template omits the familyName / familyEmail
   * columns (because the import is pre-bound to a family server-side).
   */
  boundToFamily?: boolean
}

export default function ImportMenu({ type, onUpload, disabled, boundToFamily }: Props) {
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

  const handleTemplate = () => {
    setOpen(false)
    void downloadImportTemplate(type, { boundToFamily: !!boundToFamily })
  }

  const handleUpload = () => {
    setOpen(false)
    onUpload()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Import"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowUpTrayIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Import</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-md border border-border bg-surface shadow-popover"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] font-medium text-fg-muted">
              Import {IMPORT_LABELS[type].toLowerCase()}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleTemplate}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-fg/5"
          >
            <DocumentArrowDownIcon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
            <div>
              <div>Download template</div>
              <div className="text-[11px] text-fg-muted">
                {boundToFamily ? `${type}-template-family.xlsx` : `${type}-template.xlsx`}
              </div>
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleUpload}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-fg hover:bg-fg/5"
          >
            <DocumentArrowUpIcon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
            <div>
              <div>Upload file…</div>
              <div className="text-[11px] text-fg-muted">CSV or Excel — preview, then import</div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
