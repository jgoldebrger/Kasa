'use client'

import {
  cloneElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

type TooltipTriggerProps = {
  'aria-describedby'?: string
  href?: string
  tabIndex?: number
}

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
 *
 * Tooltip content must only supplement the interface. Essential information
 * must also be present in visible text or an accessible name.
 */
export function Tooltip({
  children,
  content,
  side = 'top',
  delayMs = 200,
  className = '',
}: TooltipProps) {
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const child = isValidElement<TooltipTriggerProps>(children) ? children : null
  const isNativeInteractive =
    child !== null &&
    typeof child.type === 'string' &&
    (['button', 'input', 'select', 'textarea'].includes(child.type) ||
      (child.type === 'a' && child.props.href !== undefined))
  const usesChildFocus =
    child !== null && (isNativeInteractive || (child.props.tabIndex ?? -1) >= 0)
  const describedBy = open ? id : undefined
  const triggerChildren =
    usesChildFocus && child
      ? cloneElement(child, {
          'aria-describedby':
            [child.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        })
      : children

  const posClass =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'bottom'
        ? 'top-full left-1/2 -translate-x-1/2 mt-2'
        : side === 'left'
          ? 'end-full top-1/2 -translate-y-1/2 me-2'
          : 'start-full top-1/2 -translate-y-1/2 ms-2'

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
      tabIndex={usesChildFocus ? undefined : 0}
      aria-describedby={usesChildFocus ? undefined : describedBy}
    >
      {triggerChildren}
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
