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
import { getWritingDirection, horizontalNavDelta } from '@/lib/ui/writing-direction'

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
  align?: 'start' | 'end' | 'left' | 'right'
  /** Optional override for the trigger size (default h-8 w-8). */
  className?: string
}

const MENU_WIDTH = 176 // matches w-44
const VERTICAL_GAP = 6
const VIEWPORT_PADDING = 8

export default function ActionMenu({
  items,
  ariaLabel = 'Actions',
  align = 'end',
  className,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const focusedOnOpenRef = useRef(false)

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

    const logicalAlign = align === 'left' ? 'start' : align === 'right' ? 'end' : align
    const direction = getWritingDirection(trigger)
    const alignToRightEdge =
      (logicalAlign === 'end' && direction === 'ltr') ||
      (logicalAlign === 'start' && direction === 'rtl')

    let left: number
    if (alignToRightEdge) {
      left = rect.right - MENU_WIDTH
    } else {
      left = rect.left
    }
    // Clamp horizontally to the viewport.
    left = Math.max(
      VIEWPORT_PADDING,
      Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING),
    )

    const top = flipUp ? rect.top - menuHeight - VERTICAL_GAP : rect.bottom + VERTICAL_GAP

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

  useLayoutEffect(() => {
    if (!open) {
      focusedOnOpenRef.current = false
      return
    }
    if (!pos || focusedOnOpenRef.current) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    focusedOnOpenRef.current = true
  }, [open, pos])

  const closeAndRestoreFocus = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const getEnabledMenuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    )

  const focusMenuItem = (offset: number) => {
    const enabledItems = getEnabledMenuItems()
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
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const enabledItems = getEnabledMenuItems()
      const boundaryItem =
        e.key === 'Home' ? enabledItems[0] : enabledItems[enabledItems.length - 1]
      boundaryItem?.focus()
      return
    }

    const verticalDelta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const direction = getWritingDirection(triggerRef.current)
    const delta = verticalDelta || horizontalNavDelta(e.key, direction)
    if (delta !== 0) {
      e.preventDefault()
      focusMenuItem(delta)
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRestoreFocus()
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

      {open &&
        mounted &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={onMenuKeyDown}
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
                  closeAndRestoreFocus()
                  item.onClick()
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-colors disabled:opacity-50 ${
                  item.destructive ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-fg/5'
                } ${idx > 0 ? 'border-t border-border' : ''}`}
              >
                {item.icon && (
                  <span
                    className={
                      item.destructive
                        ? 'inline-flex h-4 w-4 items-center justify-center text-danger'
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
