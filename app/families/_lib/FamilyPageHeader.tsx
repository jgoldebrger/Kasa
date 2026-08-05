'use client'

import type { ReactNode } from 'react'

export interface FamilyPageHeaderProps {
  title: string
  description?: string
  primaryAction?: ReactNode
  secondaryActions?: ReactNode
  className?: string
  /** Tab bodies use h3; list-level callers may pass h2. */
  headingLevel?: 'h2' | 'h3'
}

export function FamilyPageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
  className = '',
  headingLevel = 'h3',
}: FamilyPageHeaderProps) {
  const Heading = headingLevel
  const actions = (
    <>
      {secondaryActions}
      {primaryAction}
    </>
  )

  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <Heading className="text-lg font-semibold text-fg">{title}</Heading>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}
