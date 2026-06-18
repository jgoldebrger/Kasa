'use client'

import { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant
  title?: ReactNode
}

const variantClass: Record<AlertVariant, string> = {
  info: 'border-border bg-app-subtle text-fg',
  success: 'border-success/30 bg-success/5 text-fg',
  warning: 'border-warning/30 bg-warning/10 text-fg',
  danger: 'border-danger/30 bg-danger/5 text-fg',
}

export function Alert({ variant = 'info', title, className, children, ...rest }: AlertProps) {
  return (
    <div
      role="status"
      className={cn('rounded-lg border p-4 text-sm', variantClass[variant], className)}
      {...rest}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-1', 'text-fg-muted')}>{children}</div>}
    </div>
  )
}
