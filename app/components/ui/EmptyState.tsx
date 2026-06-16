'use client'

import { ReactNode } from 'react'
import { Button, ButtonProps } from './Button'

export interface EmptyStateProps {
  /** Icon (emoji or svg element). */
  icon?: ReactNode
  /** Headline (one sentence). */
  title: string
  /** Optional supporting copy. */
  description?: ReactNode
  /**
   * Primary CTA. The plan calls this required so we stop shipping inert
   * empty states, but we make it optional in TS because a few read-only
   * pages legitimately can't offer one — pass null explicitly there.
   */
  cta?: { label: string; onClick?: () => void; href?: string; icon?: ReactNode } | null
  /** Optional secondary action. */
  secondaryCta?: { label: string; onClick?: () => void; href?: string }
  className?: string
}

/**
 * Standard "nothing here yet" panel. Use everywhere instead of bare
 * "No X found" text so every empty list has a clear next step.
 */
export function EmptyState({
  icon,
  title,
  description,
  cta,
  secondaryCta,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-app-subtle px-6 py-10 text-center ${className}`}
      role="region"
      aria-label={title}
    >
      {icon && (
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface border border-border text-fg-subtle [&_svg]:h-6 [&_svg]:w-6" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>}
      {(cta || secondaryCta) && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
          {secondaryCta && (
            <CtaButton {...secondaryCta} variant="secondary" />
          )}
          {cta && <CtaButton {...cta} variant="primary" />}
        </div>
      )}
    </div>
  )
}

function CtaButton({
  label,
  onClick,
  href,
  icon,
  variant,
}: {
  label: string
  onClick?: () => void
  href?: string
  icon?: ReactNode
  variant: ButtonProps['variant']
}) {
  if (href) {
    return (
      <a
        href={href}
        className={`focus-ring inline-flex min-h-[var(--touch-target)] items-center justify-center gap-2 rounded-md px-4 text-sm font-medium sm:min-h-10 ${
          variant === 'primary'
            ? 'bg-accent text-accent-fg hover:bg-accent-hover'
            : 'border border-border bg-surface text-fg hover:bg-fg/5'
        }`}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </a>
    )
  }
  return (
    <Button variant={variant} onClick={onClick} leftIcon={icon}>
      {label}
    </Button>
  )
}
