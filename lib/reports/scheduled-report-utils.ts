export type ReportScheduleFrequency = 'weekly' | 'monthly'

/** Next UTC run instant for a new or recurring schedule. */
export function computeNextRunAt(
  frequency: ReportScheduleFrequency,
  from: Date = new Date(),
): Date {
  const next = new Date(from)
  if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7)
    next.setUTCHours(8, 0, 0, 0)
    return next
  }
  next.setUTCMonth(next.getUTCMonth() + 1, 1)
  next.setUTCHours(8, 0, 0, 0)
  return next
}
