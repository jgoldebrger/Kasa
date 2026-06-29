import { HDate } from '@hebcal/hdate'

/**
 * Date / calendar helpers shared across the app.
 *
 * `addMonthsClamped` is the one most callers want when scheduling
 * "next month's payment". JS's native `Date.setMonth(getMonth() + 1)`
 * famously overflows: Jan 31 → Mar 3 (because Feb 31 doesn't exist),
 * which silently shifts a recurring schedule.
 */

/**
 * Add `count` months to `input` and clamp the day to the last valid day
 * of the resulting month. Returns a new Date — does not mutate input.
 */
export function addMonthsClamped(input: Date, count: number): Date {
  const d = new Date(input)
  const targetMonth = d.getMonth() + count
  const targetYear = d.getFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const desiredDay = d.getDate()
  // Day 0 of the *next* month is the last day of the target month —
  // standard JS Date trick.
  const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate()
  const safeDay = Math.min(desiredDay, lastDayOfTargetMonth)
  return new Date(
    targetYear,
    normalizedMonth,
    safeDay,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  )
}

/** True when `value` parses to a finite timestamp. */
export function isFiniteDate(value: Date | string | null | undefined): boolean {
  if (value == null) return false
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime())
}

/** Safe locale date formatting — returns em dash for invalid dates. */
export function formatLocaleDate(
  value: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale = 'en-US',
): string {
  if (!isFiniteDate(value)) return '—'
  const d = value instanceof Date ? value : new Date(value as string)
  return d.toLocaleDateString(locale, options)
}

/** Start of the previous calendar month as a Date (00:00 local). */
export function previousMonthStart(reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth() - 1, 1)
}

/** Inclusive end-of-month for the month containing `reference`. */
export function endOfMonth(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59, 999)
}

/**
 * Inclusive Mongo range that matches BOTH the legacy ms=000 and the new
 * ms=999 `toDate` shapes used for monthly statements. Use in dedup
 * `Statement.findOne` queries so old statements (created before the
 * ms=999 standardisation) and new ones can both be discovered without
 * inserting a duplicate row for the same period.
 *
 * Returns `{ $gte: <last-second-start>, $lte: <last-ms-of-month> }`
 * keyed on the calendar last-second of `reference`'s month.
 */
export function monthEndDedupRange(reference: Date): { $gte: Date; $lte: Date } {
  const y = reference.getFullYear()
  const m = reference.getMonth() + 1
  return {
    $gte: new Date(y, m, 0, 23, 59, 59, 0),
    $lte: new Date(y, m, 0, 23, 59, 59, 999),
  }
}

/**
 * Symmetric ±999ms tolerance band around `reference`. Use this in
 * Statement dedup checks for ARBITRARY periods (e.g. admin-picked
 * date ranges in the manual bulk-send flow) where we can't assume
 * `reference` is the calendar end-of-month, but still want to
 * discover legacy statements whose stored `toDate` differs only by
 * sub-second drift introduced by older code paths.
 */
export function tolerantMsRange(reference: Date): { $gte: Date; $lte: Date } {
  const t = reference.getTime()
  return {
    $gte: new Date(t - 999),
    $lte: new Date(t + 999),
  }
}

/** Return a `{ year, month }` pair (month is 1-12) for the previous month. */
export function previousYearMonth(reference: Date = new Date()): { year: number; month: number } {
  const d = previousMonthStart(reference)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/**
 * Previous calendar month in the org's wall-clock timezone (month is 1–12).
 * Falls back to server-local `previousYearMonth` when the zone is invalid.
 */
export function previousYearMonthInTimeZone(
  tz: string | undefined | null,
  ref: Date = new Date(),
): { year: number; month: number } {
  const zone = tz && tz.trim() ? tz : 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
    })
    const parts = fmt.formatToParts(ref).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
    let year = Number(parts.year)
    let month = Number(parts.month)
    if (!Number.isFinite(year) || !Number.isFinite(month)) throw new Error('bad tz parts')
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
    return { year, month }
  } catch {
    return previousYearMonth(ref)
  }
}

/** Inclusive UTC bounds for a Gregorian month in the org's wall-clock timezone. */
export function calendarMonthBoundsInTimeZone(
  year: number,
  month: number,
  tz: string | undefined | null,
): { fromDate: Date; toDate: Date } {
  // `month` is 1–12; day 0 of month index `month` is the last day of month `month`.
  const lastDay = new Date(year, month, 0).getDate()
  return {
    fromDate: zonedWallClockToUtc(year, month, 1, 0, 0, 0, 0, tz),
    toDate: zonedWallClockToUtc(year, month, lastDay, 23, 59, 59, 999, tz),
  }
}

/** Previous Hebrew month (month is 1–13 per Hebcal). */
export function previousHebrewYearMonth(ref: Date = new Date()): {
  year: number
  month: number
} {
  const today = new HDate(ref)
  const firstOfMonth = new HDate(1, today.getMonth(), today.getFullYear())
  const prev = firstOfMonth.subtract(1, 'M')
  return { year: prev.getFullYear(), month: prev.getMonth() }
}

/** Inclusive Gregorian bounds for a Hebrew month in the org wall-clock timezone. */
export function hebrewMonthBounds(
  hebrewYear: number,
  hebrewMonth: number,
  tz?: string | undefined | null,
): { fromDate: Date; toDate: Date } {
  const lastDay = HDate.daysInMonth(hebrewMonth, hebrewYear)
  const fromGreg = new HDate(1, hebrewMonth, hebrewYear).greg()
  const toGreg = new HDate(lastDay, hebrewMonth, hebrewYear).greg()

  if (tz && tz.trim()) {
    const fy = fromGreg.getFullYear()
    const fm = fromGreg.getMonth() + 1
    const fd = fromGreg.getDate()
    const fromDate = zonedWallClockToUtc(fy, fm, fd, 0, 0, 0, 0, tz)
    const nextDay = new Date(toGreg.getTime())
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const endExclusive = zonedWallClockToUtc(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      0,
      0,
      0,
      0,
      tz,
    )
    return { fromDate, toDate: new Date(endExclusive.getTime() - 1) }
  }

  fromGreg.setHours(0, 0, 0, 0)
  toGreg.setHours(23, 59, 59, 999)
  return { fromDate: fromGreg, toDate: toGreg }
}

/** Half-open UTC range for one calendar day in `tz`. */
export function calendarDayBoundsInTimeZone(
  tz: string | undefined | null,
  ref: Date = new Date(),
): { from: Date; toExclusive: Date } {
  const y = getYearInTimeZone(tz, ref)
  const m = getMonthInTimeZone(tz, ref)
  const d = getDayInTimeZone(tz, ref)
  const from = zonedWallClockToUtc(y, m, d, 0, 0, 0, 0, tz)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const toExclusive = zonedWallClockToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    0,
    0,
    tz,
  )
  return { from, toExclusive }
}

/**
 * Resolve the previous statement period for an org based on its
 * configured monthly-statement calendar (Gregorian wall-clock vs Hebrew).
 */
export function previousStatementPeriodBounds(
  calendar: 'gregorian' | 'hebrew' | undefined | null,
  tz: string | undefined | null,
  ref: Date = new Date(),
  override?: { year: number; month: number },
): { year: number; month: number; fromDate: Date; toDate: Date } {
  if (calendar === 'hebrew') {
    const prev = previousHebrewYearMonth(ref)
    const year = override?.year ?? prev.year
    const month = override?.month ?? prev.month
    const { fromDate, toDate } = hebrewMonthBounds(year, month, tz)
    return { year, month, fromDate, toDate }
  }
  const prev = previousYearMonthInTimeZone(tz, ref)
  const year = override?.year ?? prev.year
  const month = override?.month ?? prev.month
  const { fromDate, toDate } = calendarMonthBoundsInTimeZone(year, month, tz)
  return { year, month, fromDate, toDate }
}

/**
 * Return a Date that represents 00:00 *today* in the given IANA
 * timezone, expressed as an absolute UTC instant.
 *
 * Why this exists: recurring-payment cron uses `nextPaymentDate <= today`
 * to decide what to bill. If `today` is computed in the server's local
 * (or UTC) timezone, an org in Asia/Jerusalem will start being charged
 * at ~17:00 the previous day — confusing customers and breaking refund
 * tickets. We bound `today` to the org's wall clock instead.
 *
 * Falls back to plain server-local midnight when the runtime can't
 * resolve the zone (very old Node, malformed tz string).
 */
/**
 * Return the calendar year for `ref` as it would read on a wall clock
 * in the given IANA timezone. Falls back to server-local year when the
 * zone is unresolvable.
 *
 * Used for stamping `Payment.year` from the org's perspective — a UTC
 * tick on Jan 1 at 00:30 in NY books a Dec 31 charge that
 * `paymentDate.getFullYear()` would file under the *new* year.
 */
export function getYearInTimeZone(tz: string | undefined | null, ref: Date = new Date()): number {
  const zone = tz && tz.trim() ? tz : 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric' })
    const y = Number(fmt.format(ref))
    if (Number.isFinite(y)) return y
  } catch {
    /* fall through */
  }
  return ref.getFullYear()
}

/** Calendar month (1–12) for `ref` in the org's wall-clock timezone. */
export function getMonthInTimeZone(tz: string | undefined | null, ref: Date = new Date()): number {
  const zone = tz && tz.trim() ? tz : 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, month: 'numeric' })
    const m = Number(fmt.format(ref))
    if (Number.isFinite(m) && m >= 1 && m <= 12) return m
  } catch {
    /* fall through */
  }
  return ref.getMonth() + 1
}

/** Calendar day-of-month (1–31) for `ref` in the org's wall-clock timezone. */
export function getDayInTimeZone(tz: string | undefined | null, ref: Date = new Date()): number {
  const zone = tz && tz.trim() ? tz : 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, day: 'numeric' })
    const d = Number(fmt.format(ref))
    if (Number.isFinite(d) && d >= 1 && d <= 31) return d
  } catch {
    /* fall through */
  }
  return ref.getDate()
}

/**
 * Convert a wall-clock instant in `tz` to the corresponding UTC Date.
 * Used to build calendar-year bounds that match how the org files payments.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tz: string | undefined | null,
): Date {
  const zone = tz && tz.trim() ? tz : 'UTC'
  if (zone === 'UTC') {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms))
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms)
    const probe = new Date(utcGuess)
    const probeParts = fmt.formatToParts(probe).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
    const probeUtc = Date.UTC(
      Number(probeParts.year),
      Number(probeParts.month) - 1,
      Number(probeParts.day),
      Number(probeParts.hour),
      Number(probeParts.minute),
      Number(probeParts.second),
    )
    const offsetMs = probeUtc - utcGuess
    return new Date(utcGuess - offsetMs)
  } catch {
    return new Date(year, month - 1, day, hour, minute, second, ms)
  }
}

/** Half-open UTC range [Jan 1 00:00, Jan 1 next year 00:00) in `tz`. */
export function calendarYearBoundsInTimeZone(
  year: number,
  tz: string | undefined | null,
): { start: Date; endExclusive: Date } {
  return {
    start: zonedWallClockToUtc(year, 1, 1, 0, 0, 0, 0, tz),
    endExclusive: zonedWallClockToUtc(year + 1, 1, 1, 0, 0, 0, 0, tz),
  }
}

/** `YYYY-MM-DD` wall-clock key for `ref` in the org timezone. */
export function dateKeyInTimeZone(tz: string | undefined | null, ref: Date = new Date()): string {
  const y = getYearInTimeZone(tz, ref)
  const m = getMonthInTimeZone(tz, ref)
  const d = getDayInTimeZone(tz, ref)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Parse a `YYYY-MM-DD` key produced by `dateKeyInTimeZone`. */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** Inclusive UTC bounds for one org-timezone calendar day from a date key. */
export function calendarDayBoundsFromDateKey(
  key: string,
  tz: string | undefined | null,
): { fromDate: Date; toDate: Date } | null {
  const parsed = parseDateKey(key)
  if (!parsed) return null
  const { year, month, day } = parsed
  return {
    fromDate: zonedWallClockToUtc(year, month, day, 0, 0, 0, 0, tz),
    toDate: zonedWallClockToUtc(year, month, day, 23, 59, 59, 999, tz),
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

/** Day-of-week index (0 = Sunday) for `ref` in the org wall-clock timezone. */
export function getWeekdayInTimeZone(
  tz: string | undefined | null,
  ref: Date = new Date(),
): number {
  const zone = tz && tz.trim() ? tz : 'UTC'
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(ref)
    const idx = WEEKDAY_INDEX[day]
    if (idx !== undefined) return idx
  } catch {
    /* fall through */
  }
  return ref.getDay()
}

/** Shift a date key by `delta` calendar days (Gregorian). */
export function addCalendarDaysToDateKey(
  key: string,
  delta: number,
  tz: string | undefined | null,
): string {
  const parsed = parseDateKey(key)
  if (!parsed) return key
  const anchor = zonedWallClockToUtc(parsed.year, parsed.month, parsed.day, 12, 0, 0, 0, tz)
  const shifted = new Date(anchor.getTime() + delta * 86_400_000)
  return dateKeyInTimeZone(tz, shifted)
}

/** Last calendar day (1–31) for a Gregorian month. */
export function daysInGregorianMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function startOfDayInTimeZone(tz: string | undefined | null, ref: Date = new Date()): Date {
  const zone = tz && tz.trim() ? tz : 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const parts = fmt.formatToParts(ref).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
    const y = Number(parts.year)
    const m = Number(parts.month)
    const d = Number(parts.day)
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      throw new Error('bad tz parts')
    }
    // Construct the same wall-clock instant ('YYYY-MM-DD 00:00:00') in
    // the target zone, then back out what UTC instant that is. Because
    // Intl can't directly "parse with timezone", we use the offset
    // round-trip: compute UTC midnight for that date, then add the
    // difference between (UTC view of that midnight) and (tz view of
    // that midnight).
    const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
    const probe = new Date(utcMidnight)
    const probeParts = fmt.formatToParts(probe).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
    const probeUtc = Date.UTC(
      Number(probeParts.year),
      Number(probeParts.month) - 1,
      Number(probeParts.day),
      Number(probeParts.hour),
      Number(probeParts.minute),
      Number(probeParts.second),
    )
    const offsetMs = probeUtc - utcMidnight
    return new Date(utcMidnight - offsetMs)
  } catch {
    const d = new Date(ref)
    d.setHours(0, 0, 0, 0)
    return d
  }
}
