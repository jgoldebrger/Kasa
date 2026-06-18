'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Render a spinner and disable input. */
  loading?: boolean
  /** Optional icon node rendered before the label. */
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  /** Make the button full-width on its row. */
  block?: boolean
}

const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover active:bg-accent-hover disabled:bg-accent/50 disabled:text-accent-fg/80',
  secondary:
    'bg-surface text-fg border border-border shadow-sm hover:bg-fg/5 active:bg-fg/10 disabled:bg-app-subtle disabled:text-fg-subtle',
  ghost:
    'bg-transparent text-fg-muted hover:bg-fg/5 hover:text-fg active:bg-fg/10 disabled:text-fg-subtle',
  destructive:
    'bg-danger text-white shadow-sm hover:bg-danger/90 active:bg-danger/80 disabled:bg-danger/40 disabled:text-white/80',
  link: 'bg-transparent text-accent hover:underline disabled:text-accent/50 px-0 py-0',
}

const sizeClass: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-md gap-1.5',
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  lg: 'h-12 px-5 text-base rounded-lg gap-2',
}

/**
 * App-wide Button. Use this instead of bare <button> so we get consistent
 * sizing, focus rings, loading state, and touch targets.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    block = false,
    disabled,
    className = '',
    children,
    type,
    ...rest
  },
  ref,
) {
  const isLink = variant === 'link'
  const base =
    'inline-flex items-center justify-center font-medium transition-colors duration-150 active:scale-[0.98] focus-ring select-none disabled:cursor-not-allowed'
  const touch = isLink ? '' : 'min-h-[var(--touch-target)] sm:min-h-0'
  const widthCls = block ? 'w-full' : ''

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        base,
        variantClass[variant],
        !isLink && sizeClass[size],
        touch,
        widthCls,
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={size} />
      ) : (
        leftIcon && <span className="-ml-0.5 inline-flex">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="-mr-0.5 inline-flex">{rightIcon}</span>}
    </button>
  )
})

function Spinner({ size }: { size: Size }) {
  const px = size === 'sm' ? 14 : size === 'lg' ? 20 : 16
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
