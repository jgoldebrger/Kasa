import { startOfDayInTimeZone } from '@/lib/date-utils'

const MS_PER_DAY = 86_400_000

export function calendarDaysBetween(
  from: Date,
  to: Date,
  timezone: string | null | undefined,
): number {
  const a = startOfDayInTimeZone(timezone, from).getTime()
  const b = startOfDayInTimeZone(timezone, to).getTime()
  return Math.floor((b - a) / MS_PER_DAY)
}

export function canReceiveDunningEmail(family: {
  email?: string | null
  emailFormatInvalid?: boolean
  communicationsOptOut?: boolean
}): boolean {
  if (family.communicationsOptOut) return false
  if (family.emailFormatInvalid) return false
  if (!family.email || family.email.trim() === '') return false
  return true
}

export function qualifiesForDunning(input: {
  balance: number
  minOwed: number
  obligationStart: Date
  now: Date
  timezone: string | null | undefined
  daysSinceObligation: number
}): boolean {
  if (!(input.balance >= input.minOwed)) return false
  const days = calendarDaysBetween(input.obligationStart, input.now, input.timezone)
  return days >= input.daysSinceObligation
}
