/** Required fields on the Add/Edit Family modal (matches UI labels). */
export type FamilyFormFields = {
  name: string
  hebrewName: string
  weddingDate: string
  husbandHebrewName: string
  wifeHebrewName: string
  paymentPlanId: string
  email?: string
}

const OBJECT_ID = /^[a-f0-9]{24}$/i

/** Returns a user-facing error message, or null when the form is valid. */
export function validateFamilyFormFields(fields: FamilyFormFields): string | null {
  if (!fields.name?.trim()) return 'Family name is required.'
  if (!fields.hebrewName?.trim()) return 'Family name (Hebrew) is required.'
  if (!fields.husbandHebrewName?.trim()) return "Husband's Hebrew first name is required."
  if (!fields.wifeHebrewName?.trim()) return "Wife's Hebrew first name is required."
  if (!fields.weddingDate?.trim()) return 'Wedding date is required.'
  if (!fields.paymentPlanId?.trim()) return 'Please select a payment plan.'
  if (!OBJECT_ID.test(fields.paymentPlanId.trim())) {
    return 'Please select a valid payment plan.'
  }
  return null
}

/** Map API error JSON to a toast-friendly message. */
export function parseFamilySaveError(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Could not save family.'
  const err = body as Record<string, unknown>
  if (typeof err.error === 'string' && err.error !== 'Validation failed') {
    return err.error
  }
  const issues = err.issues
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0] as { path?: string; message?: string }
    const path = first.path ? `${first.path}: ` : ''
    if (first.message) return `${path}${first.message}`
  }
  if (typeof err.details === 'string') return err.details
  return typeof err.error === 'string' ? err.error : 'Could not save family.'
}
