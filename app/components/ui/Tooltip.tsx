'use client'

import { ReactNode, useEffect, useId, useRef, useState } from 'react'

export interface TooltipProps {
  /** The element that, when hovered/focused, shows the tooltip. */
  children: ReactNode
  /** Tooltip body — kept short, one phrase. */
  content: ReactNode
  /** Position; defaults to 'top'. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Delay before showing (ms). */
  delayMs?: number
  className?: string
}

/**
 * Minimal accessible tooltip. The trigger gets `aria-describedby` pointing
 * at the tooltip text, which is rendered as a visually-positioned element
 * with role="tooltip". Shows on hover + focus, hides on mouse-leave + blur.
 */
export function Tooltip({ children, content, side = 'top', delayMs = 200, className = '' }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<NodeJS.Timeout | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)

  function show() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delayMs)
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const posClass =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'bottom'
      ? 'top-full left-1/2 -translate-x-1/2 mt-2'
      : side === 'left'
      ? 'right-full top-1/2 -translate-y-1/2 mr-2'
      : 'left-full top-1/2 -translate-y-1/2 ml-2'

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
      className={`relative inline-flex ${className}`}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute z-40 max-w-xs rounded-md bg-fg text-app px-2 py-1 text-xs shadow-popover animate-ui-fade ${posClass}`}
        >
          {content}
        </span>
      )}
    </span>
  )
}
