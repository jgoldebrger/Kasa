'use client'

import { TextareaHTMLAttributes, forwardRef } from 'react'
import { useFieldIds } from '@/lib/ui/field-ids'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Field label rendered above the textarea.
   * At least one of `label`, `aria-label`, or `aria-labelledby` is required for accessibility.
   */
  label?: string
  hint?: string
  error?: string | null
  labelHidden?: boolean
  wrapperClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
    required,
    labelHidden = false,
    id,
    rows = 4,
    className = '',
    wrapperClassName = '',
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
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(hint, error)}
        required={required}
        className={`focus-ring w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors disabled:bg-app-subtle ${
          error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent'
        } ${className}`}
        {...rest}
      />
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
