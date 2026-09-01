'use client'

import { SelectHTMLAttributes, forwardRef } from 'react'
import { useFieldIds } from '@/lib/ui/field-ids'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * Field label rendered above the select.
   * At least one of `label`, `aria-label`, or `aria-labelledby` is required for accessibility.
   */
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
  const { fieldId, hintId, errorId, describedBy } = useFieldIds(id)

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <label
          htmlFor={fieldId}
          className={`text-sm font-medium text-fg ${labelHidden ? 'sr-only' : ''}`}
        >
          {label}
          {required && (
            <span className="ms-0.5 text-danger" aria-hidden="true">
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
        aria-describedby={describedBy(error ? undefined : hint, error)}
        required={required}
        className={`focus-ring w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg transition-colors disabled:bg-app-subtle disabled:text-fg-muted ${
          error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent'
        } ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
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
