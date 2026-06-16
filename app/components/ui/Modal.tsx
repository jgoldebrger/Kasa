'use client'

import { ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Visible title — used for accessibility (aria-labelledby). */
  title: ReactNode
  /** Optional description shown under the title. */
  description?: ReactNode
  /** Body content. */
  children?: ReactNode
  /** Right-aligned footer slot — typically Cancel + primary action. */
  footer?: ReactNode
  /** Tailwind max-width class. Default 'max-w-lg'. */
  maxWidth?: string
  /** Disable click-outside / Escape dismissal (use sparingly). */
  dismissible?: boolean
}

/**
 * Accessible modal dialog.
 *
 * - role="dialog" + aria-modal
 * - Focus trapped within the dialog while open
 * - Escape closes (unless dismissible=false)
 * - Click on backdrop closes
 * - Restores focus to the previously focused element on close
 * - Locks body scroll while open
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-lg',
  dismissible = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Manage scroll lock + focus on open/close.
  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Defer the first focus until the portal node is mounted.
    const t = setTimeout(() => {
      const node = dialogRef.current
      if (!node) return
      const focusable = node.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ;(focusable || node).focus()
    }, 0)

    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  // Keyboard: Escape closes, Tab cycles within the dialog.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissible) {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const node = dialogRef.current
      if (!node) return
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, dismissible])

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-ui-fade"
      onMouseDown={(e) => {
        if (!dismissible) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl bg-surface border border-border shadow-popover animate-ui-scale focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="focus-ring -mr-1 -mt-1 inline-flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg sm:min-h-9 sm:min-w-9"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="px-5 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 bg-app-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
