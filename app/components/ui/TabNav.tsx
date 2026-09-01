'use client'

import Link from 'next/link'
import { ReactNode, useId } from 'react'

export interface TabNavItem {
  id: string
  href: string
  label: ReactNode
  trailing?: ReactNode
}

export interface TabNavProps {
  items: TabNavItem[]
  /** Id of the active item (usually derived from pathname). */
  activeId: string
  /** Accessible name for the navigation. */
  label?: string
  className?: string
}

/**
 * Route-based tab strip — same visual language as `Tabs`, but uses links
 * with aria-current (correct for cross-page section nav).
 */
export function TabNav({ items, activeId, label = 'Sections', className = '' }: TabNavProps) {
  const groupId = useId()

  return (
    <nav
      aria-label={label}
      className={`-mx-2 flex gap-1 overflow-x-auto px-2 sm:mx-0 sm:px-0 border-b border-border ${className}`}
      style={{ scrollbarWidth: 'thin' }}
    >
      {items.map((item) => {
        const selected = item.id === activeId
        return (
          <Link
            key={item.id}
            id={`${groupId}-tab-${item.id}`}
            href={item.href}
            aria-current={selected ? 'page' : undefined}
            className={`focus-ring relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 -mb-px text-sm font-medium transition-colors min-h-[var(--touch-target)] sm:min-h-0 border-b-2 ${
              selected
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-muted hover:text-fg hover:border-border-strong'
            }`}
          >
            {item.label}
            {item.trailing}
          </Link>
        )
      })}
    </nav>
  )
}
