'use client'

import { HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Tighter padding for dense panels. */
  compact?: boolean
  /** Skip default padding (use for custom inner layout). */
  noPadding?: boolean
}

/**
 * Standard elevated surface. Prefer this over ad-hoc `surface-card p-6` copies.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, compact = false, noPadding = false, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'surface-card',
        !noPadding && (compact ? 'p-4 sm:p-5' : 'p-4 sm:p-6'),
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
})
