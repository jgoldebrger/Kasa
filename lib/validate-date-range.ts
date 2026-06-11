/** Maximum allowed span for report/audit date ranges (366 days). */
export const MAX_DATE_RANGE_MS = 366 * 24 * 60 * 60 * 1000

/** Returns an error message when invalid, or null when OK. */
export function validateDateRange(
  from: Date,
  to: Date,
  opts?: { maxSpanMs?: number },
): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 'Invalid date'
  }
  if (from.getTime() > to.getTime()) {
    return 'fromDate must be on or before toDate'
  }
  const maxSpan = opts?.maxSpanMs ?? MAX_DATE_RANGE_MS
  if (to.getTime() - from.getTime() > maxSpan) {
    return 'Date range cannot exceed one year'
  }
  const fy = from.getFullYear()
  const ty = to.getFullYear()
  if (fy < 1900 || fy > 2200 || ty < 1900 || ty > 2200) {
    return 'Date out of supported range (1900–2200)'
  }
  return null
}
