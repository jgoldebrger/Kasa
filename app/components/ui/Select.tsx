'use client'

import { SelectHTMLAttributes, forwardRef, useId } from 'react'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string | null
  labelHidden?: boolean
  wrapperClassName?: string
}

/**
 * App-wide native <select>. We avoid a custom listbox to keep keyboard
 * support and mobile native pickers automatic.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    required,
    labelHidden = false,
    id,
    className = '',
    wrapperClassName = '',
    children,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const fieldId = id || `s-${autoId}`
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-err` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <label
          htmlFor={fieldId}
          className={`text-sm font-medium text-fg ${labelHidden ? 'sr-only' : ''}`}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-red-600 dark:text-red-400" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        required={required}
        className={`focus-ring w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg transition-colors disabled:bg-app-subtle disabled:text-fg-muted ${
          error ? 'border-red-400 focus:border-red-500 dark:border-red-500/60' : 'border-border focus:border-accent'
        } ${className}`}
        {...rest}
      >
        {children}
      </select>
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
