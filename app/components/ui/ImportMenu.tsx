'use client'

/**
 * ImportMenu — small popover anchored under an upload icon button. Lets the
 * user either grab the CSV template for the current data type or open the
 * upload modal. Used internally by <DataView> when `import` is configured.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpTrayIcon,
  DocumentArrowDownIcon,
  DocumentArrowUpIcon,
} from '@heroicons/react/24/outline'
import { downloadImportTemplate, IMPORT_LABELS, type ImportType } from '@/lib/import-templates'

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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const closeAndRestoreFocus = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  const focusMenuItem = (offset: number) => {
    const enabledItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    )
    if (enabledItems.length === 0) return

    const currentIndex = enabledItems.findIndex((item) => item === document.activeElement)
    const startIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0
    const nextIndex = (startIndex + offset + enabledItems.length) % enabledItems.length
    enabledItems[nextIndex]?.focus()
  }

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeAndRestoreFocus()
      return
    }

    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (delta !== 0) {
      e.preventDefault()
      focusMenuItem(delta)
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRestoreFocus()
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
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Import"
        title="Import"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowUpTrayIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Import</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="absolute end-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-md border border-border bg-surface shadow-popover"
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
            className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-fg hover:bg-fg/5"
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
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-start text-sm text-fg hover:bg-fg/5"
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
