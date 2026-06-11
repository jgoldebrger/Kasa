'use client'

import { useEffect } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[100] flex items-center justify-center p-4 animate-ui-fade"
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-popover max-w-md w-full p-6 space-y-4 animate-ui-scale"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center shrink-0">
              <ExclamationTriangleIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            <p className="text-sm text-fg-muted mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="focus-ring px-4 py-2 text-sm font-medium text-fg bg-fg/5 hover:bg-fg/10 rounded-md"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`focus-ring px-4 py-2 text-sm font-medium text-white rounded-md ${
              destructive
                ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
