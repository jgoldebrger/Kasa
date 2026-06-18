'use client'

import { ReactNode } from 'react'
import { Card } from '@/app/components/ui/Card'
import { cn } from '@/lib/cn'

export interface SettingsPanelProps {
  icon: ReactNode
  title: string
  description?: string
  children: ReactNode
  className?: string
  /** Optional actions rendered in the header row (e.g. save button). */
  actions?: ReactNode
}

/**
 * Shared settings section chrome: accent icon tile + title + body slot.
 */
export function SettingsPanel({
  icon,
  title,
  description,
  children,
  className,
  actions,
}: SettingsPanelProps) {
  return (
    <Card className={className}>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&_svg]:h-5 [&_svg]:w-5"
            aria-hidden="true"
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className={cn('flex shrink-0 items-center gap-2')}>{actions}</div>}
      </div>
      {children}
    </Card>
  )
}
