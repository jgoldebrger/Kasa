import { dateKeyInTimeZone, parseDateKey } from '@/lib/date-utils'

const MS_PER_DAY = 86_400_000

export function calendarDaysBetween(
  from: Date,
  to: Date,
  timezone: string | null | undefined,
): number {
  const fromKey = dateKeyInTimeZone(timezone, from)
  const toKey = dateKeyInTimeZone(timezone, to)
  const fromParsed = parseDateKey(fromKey)
  const toParsed = parseDateKey(toKey)
  if (!fromParsed || !toParsed) {
    throw new Error(`Invalid date key: ${fromKey} or ${toKey}`)
  }
  const fromUtc = Date.UTC(fromParsed.year, fromParsed.month - 1, fromParsed.day)
  const toUtc = Date.UTC(toParsed.year, toParsed.month - 1, toParsed.day)
  return (toUtc - fromUtc) / MS_PER_DAY
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
  const owed = Math.max(0, -input.balance)
  if (!(owed >= input.minOwed)) return false
  const days = calendarDaysBetween(input.obligationStart, input.now, input.timezone)
  return days >= input.daysSinceObligation
}
