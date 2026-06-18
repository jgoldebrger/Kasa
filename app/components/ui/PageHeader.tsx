'use client'

import { ReactNode } from 'react'

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Right-aligned actions (buttons / links). Wraps below the title under 640px. */
  actions?: ReactNode
  /** Optional breadcrumb or back-link slot rendered above the title. */
  eyebrow?: ReactNode
  className?: string
}

/**
 * Standard page header. Use at the top of every route page so margins,
 * font sizes, and responsive wrapping are consistent.
 */
export function PageHeader({ title, subtitle, actions, eyebrow, className = '' }: PageHeaderProps) {
  return (
    <header
      className={`mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-6 ${className}`}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
            {eyebrow}
          </div>
        )}
        <h1 className="hidden truncate text-xl font-semibold tracking-tight text-fg md:block sm:text-2xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">{actions}</div>}
    </header>
  )
}
