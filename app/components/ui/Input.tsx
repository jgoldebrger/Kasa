'use client'

import { InputHTMLAttributes, forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the input. Required for a11y unless `aria-label` is supplied. */
  label?: string
  /** Soft helper text shown when there is no error. */
  hint?: string
  /** Error message — when present, takes precedence over `hint` and toggles error styling. */
  error?: string | null
  /** Hide the label visually but keep it for screen readers. */
  labelHidden?: boolean
  /** Render an icon (svg / emoji) on the left side of the field. */
  leftIcon?: React.ReactNode
  /** Render an icon on the right side. */
  rightIcon?: React.ReactNode
  /** Tailwind tweaks for the wrapping <div>. */
  wrapperClassName?: string
}

/**
 * App-wide Input with label / hint / error slots, wired aria-describedby.
 * Use this for every text-like input so error UX is consistent.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    required,
    labelHidden = false,
    leftIcon,
    rightIcon,
    id,
    className = '',
    wrapperClassName = '',
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const fieldId = id || `f-${autoId}`
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-err` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label
          htmlFor={fieldId}
          className={`text-sm font-medium text-fg ${labelHidden ? 'sr-only' : ''}`}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-fg-subtle">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          required={required}
          className={cn(
            'focus-ring w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors disabled:bg-app-subtle disabled:text-fg-muted',
            error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent',
            leftIcon && 'pl-10',
            rightIcon && 'pr-10',
            className,
          )}
          {...rest}
        />
        {rightIcon && (
          <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-fg-subtle">
            {rightIcon}
          </span>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
})
