'use client'

import { TextareaHTMLAttributes, forwardRef, useId } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
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
  const autoId = useId()
  const fieldId = id || `t-${autoId}`
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
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        required={required}
        className={`focus-ring w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors disabled:bg-app-subtle ${
          error ? 'border-red-400 focus:border-red-500 dark:border-red-500/60' : 'border-border focus:border-accent'
        } ${className}`}
        {...rest}
      />
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
