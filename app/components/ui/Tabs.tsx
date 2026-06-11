'use client'

import { KeyboardEvent, ReactNode, useId, useRef } from 'react'

export interface TabItem {
  /** Stable key. */
  id: string
  /** Visible label. */
  label: ReactNode
  /** Optional badge / icon node rendered after the label. */
  trailing?: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  activeId: string
  onChange: (id: string) => void
  /** Accessible name for the tablist. */
  label?: string
  className?: string
}

/**
 * Accessible tablist with arrow-key navigation.
 *
 * - Renders horizontal scroll on narrow viewports without breaking
 * - Each tab is a button with role="tab", aria-selected, tabindex management
 */
export function Tabs({ items, activeId, onChange, label = 'Tabs', className = '' }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const groupId = useId()

  function focusByOffset(currentIdx: number, offset: number) {
    const len = items.length
    let i = currentIdx
    for (let n = 0; n < len; n++) {
      i = (i + offset + len) % len
      const item = items[i]
      if (!item.disabled) {
        refs.current[item.id]?.focus()
        onChange(item.id)
        return
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusByOffset(idx, 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusByOffset(idx, -1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusByOffset(-1, 1)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusByOffset(items.length, -1)
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`-mx-2 flex gap-1 overflow-x-auto px-2 sm:mx-0 sm:px-0 border-b border-border ${className}`}
      style={{ scrollbarWidth: 'thin' }}
    >
      {items.map((item, idx) => {
        const selected = item.id === activeId
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el
            }}
            id={`${groupId}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${groupId}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={`focus-ring relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 -mb-px text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 border-b-2 ${
              selected
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-muted hover:text-fg hover:border-border-strong'
            }`}
          >
            {item.label}
            {item.trailing}
          </button>
        )
      })}
    </div>
  )
}
