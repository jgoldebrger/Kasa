'use client'

import {
  ChangeEvent,
  FocusEvent,
  FormEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { ZodError, ZodSchema } from 'zod'

type FieldValue = string | number | boolean | null | undefined
type Values = Record<string, any>
type ErrorMap = Record<string, string | undefined>
type TouchedMap = Record<string, boolean | undefined>

export interface UseFormStateOptions<TSchemaOut> {
  /** Zod schema that validates `values`. The parsed output is passed to onSubmit. */
  schema: ZodSchema<TSchemaOut>
  /** Initial form values. */
  initialValues: Values
  /** Called after successful client-side validation. Receives the parsed
   *  (and possibly transformed) values from zod. Returning a promise will
   *  set `isSubmitting` until it resolves. */
  onSubmit: (values: TSchemaOut, helpers: { setFieldError: (k: string, msg: string) => void }) => void | Promise<void>
}

export interface UseFormStateResult {
  values: Values
  errors: ErrorMap
  touched: TouchedMap
  isSubmitting: boolean
  /** Spread on a controlled input: <input {...register('email')} /> */
  register: (name: string, opts?: { type?: 'string' | 'number' | 'checkbox' }) => {
    name: string
    value: any
    checked?: boolean
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
    onBlur: (e: FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
    error?: string
  }
  /** Get an error for a field (only shown if the field has been touched). */
  fieldError: (name: string) => string | undefined
  /** Imperatively set a field value (eg from a custom control). */
  setValue: (name: string, value: FieldValue) => void
  /** Set an error message — useful for server-side validation errors. */
  setFieldError: (name: string, message: string) => void
  /** Reset to initialValues. */
  reset: () => void
  /** Bind to <form onSubmit={handleSubmit}>. */
  handleSubmit: (e: FormEvent) => void
}

/**
 * Zod-backed form state hook with onBlur + onSubmit validation.
 *
 * - Field errors only show after the field has been blurred OR after the
 *   user attempts to submit. This avoids the "red error on every empty
 *   field the moment the form mounts" anti-pattern.
 * - Server errors can be threaded back via setFieldError from inside
 *   onSubmit so they appear next to the right field.
 */
export function useFormState<T = Values>({
  schema,
  initialValues,
  onSubmit,
}: UseFormStateOptions<T>): UseFormStateResult {
  const [values, setValues] = useState<Values>(() => ({ ...initialValues }))
  const [errors, setErrors] = useState<ErrorMap>({})
  const [touched, setTouched] = useState<TouchedMap>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validate = useCallback(
    (next: Values): { ok: true; parsed: T } | { ok: false; errs: ErrorMap } => {
      const r = schema.safeParse(next)
      if (r.success) return { ok: true, parsed: r.data as T }
      const errs: ErrorMap = {}
      ;(r.error as ZodError).issues.forEach((iss) => {
        const path = iss.path.join('.')
        if (!errs[path]) errs[path] = iss.message
      })
      return { ok: false, errs }
    },
    [schema],
  )

  const validateField = useCallback(
    (name: string, next: Values) => {
      const r = validate(next)
      setErrors((cur) => ({
        ...cur,
        [name]: r.ok ? undefined : r.errs[name],
      }))
    },
    [validate],
  )

  const setValue = useCallback(
    (name: string, value: FieldValue) => {
      setValues((cur) => {
        const next = { ...cur, [name]: value }
        // Only re-validate this field if it has been touched OR currently
        // has an error (so fixing the input clears the error immediately).
        if (touched[name] || errors[name]) validateField(name, next)
        return next
      })
    },
    [touched, errors, validateField],
  )

  const setFieldError = useCallback((name: string, message: string) => {
    setErrors((cur) => ({ ...cur, [name]: message }))
    setTouched((cur) => ({ ...cur, [name]: true }))
  }, [])

  const register = useCallback(
    (name: string, opts: { type?: 'string' | 'number' | 'checkbox' } = {}) => {
      const type = opts.type || 'string'
      return {
        name,
        value: type === 'checkbox' ? undefined : values[name] ?? '',
        checked: type === 'checkbox' ? Boolean(values[name]) : undefined,
        onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
          const t = e.target as HTMLInputElement
          if (type === 'checkbox') {
            setValue(name, t.checked)
          } else if (type === 'number') {
            const raw = t.value
            setValue(name, raw === '' ? '' : Number(raw))
          } else {
            setValue(name, t.value)
          }
        },
        onBlur: () => {
          setTouched((cur) => ({ ...cur, [name]: true }))
          validateField(name, values)
        },
        error: touched[name] ? errors[name] : undefined,
      }
    },
    [values, touched, errors, setValue, validateField],
  )

  const fieldError = useCallback(
    (name: string) => (touched[name] ? errors[name] : undefined),
    [touched, errors],
  )

  const reset = useCallback(() => {
    setValues({ ...initialValues })
    setErrors({})
    setTouched({})
    setIsSubmitting(false)
  }, [initialValues])

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      // Mark every known field touched so submission shows all errors at once.
      setTouched(() => {
        const all: TouchedMap = {}
        Object.keys(values).forEach((k) => (all[k] = true))
        Object.keys(initialValues).forEach((k) => (all[k] = true))
        return all
      })
      const r = validate(values)
      if (!r.ok) {
        setErrors(r.errs)
        // Focus the first invalid field, if reachable in the DOM.
        const firstKey = Object.keys(r.errs)[0]
        if (firstKey && typeof document !== 'undefined') {
          const node = document.querySelector<HTMLElement>(`[name="${firstKey}"]`)
          node?.focus?.()
        }
        return
      }
      setErrors({})
      const ret = onSubmit(r.parsed, { setFieldError })
      if (ret instanceof Promise) {
        setIsSubmitting(true)
        ret.finally(() => setIsSubmitting(false))
      }
    },
    [validate, values, initialValues, onSubmit, setFieldError],
  )

  return useMemo(
    () => ({
      values,
      errors,
      touched,
      isSubmitting,
      register,
      fieldError,
      setValue,
      setFieldError,
      reset,
      handleSubmit,
    }),
    [
      values,
      errors,
      touched,
      isSubmitting,
      register,
      fieldError,
      setValue,
      setFieldError,
      reset,
      handleSubmit,
    ],
  )
}
