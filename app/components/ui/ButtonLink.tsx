'use client'

import Link from 'next/link'
import { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type ButtonLinkVariant = 'primary' | 'secondary' | 'ghost'

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonLinkVariant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
}

const variantClass: Record<ButtonLinkVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover active:bg-accent-hover',
  secondary: 'bg-surface text-fg border border-border shadow-sm hover:bg-fg/5 active:bg-fg/10',
  ghost: 'bg-transparent text-fg-muted hover:bg-fg/5 hover:text-fg',
}

const sizeClass = {
  sm: 'h-9 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-5 text-base rounded-lg',
}

/** Link styled as a button — for marketing CTAs and in-app navigation actions. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(
        'focus-ring inline-flex items-center justify-center font-medium transition-colors duration-150 active:scale-[0.98] select-none min-h-[var(--touch-target)] sm:min-h-0',
        variantClass[variant],
        sizeClass[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  )
}
