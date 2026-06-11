'use client'

/**
 * ActionMenu — small 3-dot kebab popover used in table rows / cards to
 * surface row-level actions without taking up horizontal space.
 *
 * The menu is rendered into a portal with `position: fixed` so it escapes
 * the table's overflow container (otherwise the popover gets clipped when
 * the row is near the bottom of the table). Placement automatically flips
 * up when there isn't enough room below the trigger.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline'

export interface ActionMenuItem {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  destructive?: boolean
  disabled?: boolean
}

export interface ActionMenuProps {
  items: ActionMenuItem[]
  ariaLabel?: string
  align?: 'left' | 'right'
  /** Optional override for the trigger size (default h-8 w-8). */
  className?: string
}

const MENU_WIDTH = 176 // matches w-44
const VERTICAL_GAP = 6
const VIEWPORT_PADDING = 8

export default function ActionMenu({
  items,
  ariaLabel = 'Actions',
  align = 'right',
  className,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? items.length * 40 + 8
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING
    const spaceAbove = rect.top - VIEWPORT_PADDING
    const flipUp = spaceBelow < menuHeight + VERTICAL_GAP && spaceAbove > spaceBelow

    let left: number
    if (align === 'right') {
      left = rect.right - MENU_WIDTH
    } else {
      left = rect.left
    }
    // Clamp horizontally to the viewport.
    left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING))

    const top = flipUp
      ? rect.top - menuHeight - VERTICAL_GAP
      : rect.bottom + VERTICAL_GAP

    setPos({ top, left, placement: flipUp ? 'top' : 'bottom' })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    // Re-measure once after the menu mounts so we use its real height.
    const raf = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScrollOrResize = () => updatePosition()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={
          className ||
          'focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg transition-colors'
        }
      >
        <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && mounted && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-[1000] overflow-hidden rounded-md border border-border bg-surface shadow-popover"
        >
          {items.map((item, idx) => (
            <button
              key={`${item.label}-${idx}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                item.onClick()
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                item.destructive
                  ? 'text-red-700 hover:bg-red-50'
                  : 'text-fg hover:bg-fg/5'
              } ${idx > 0 ? 'border-t border-border' : ''}`}
            >
              {item.icon && (
                <span
                  className={
                    item.destructive
                      ? 'inline-flex h-4 w-4 items-center justify-center text-red-700'
                      : 'inline-flex h-4 w-4 items-center justify-center text-fg-subtle'
                  }
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
