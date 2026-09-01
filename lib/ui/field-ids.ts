import { useId } from 'react'

export function buildFieldIds(autoId: string, id?: string) {
  const fieldId = id || autoId
  return {
    fieldId,
    hintId: `${fieldId}-hint`,
    errorId: `${fieldId}-err`,
    describedBy(hint?: string, error?: string | null) {
      const parts: string[] = []
      if (hint) parts.push(`${fieldId}-hint`)
      if (error) parts.push(`${fieldId}-err`)
      return parts.length ? parts.join(' ') : undefined
    },
  }
}

/** React helper wrapping buildFieldIds + useId. */
export function useFieldIds(id?: string) {
  const autoId = useId()
  return buildFieldIds(autoId, id)
}
