import { HDate } from '@hebcal/core'

/**
 * Resolve a stored Hebrew month name into the Hebcal numeric month for
 * a specific Hebrew year.
 *
 * The old static map (`Adar I -> 12`, `Adar II -> 13`, `Adar -> 12`)
 * is wrong in two cases:
 *   - In a regular (non-leap) year there is no month 13, only Adar=12.
 *     `Adar II` should fall back to plain Adar in that year.
 *   - In a leap year a bare "Adar" is ambiguous: halachic convention
 *     for bar/bat mitzvahs and yahrzeits is to use Adar II (the second
 *     Adar) — see Shulchan Arukh OC 568:7 / 685.
 *
 * Returning `null` for unknown names lets callers fail loudly instead
 * of silently inventing dates.
 */
function resolveHebrewMonth(monthName: string, hebrewYear: number): number | null {
  const isLeap = HDate.isLeapYear(hebrewYear)
  const map: Record<string, number> = {
    Nisan: 1,
    Iyar: 2,
    Sivan: 3,
    Tammuz: 4,
    Av: 5,
    Elul: 6,
    Tishrei: 7,
    Cheshvan: 8,
    Kislev: 9,
    Tevet: 10,
    Shevat: 11,
  }
  if (map[monthName]) return map[monthName]
  if (monthName === 'Adar') return isLeap ? 13 /* Adar II */ : 12
  if (monthName === 'Adar I') return isLeap ? 12 : 12 /* degrade to Adar */
  if (monthName === 'Adar II') return isLeap ? 13 : 12 /* degrade to Adar */
  // Hebcal canonical name has 'Adar1' / 'Adar2' too — accept those.
  if (monthName === 'Adar1') return isLeap ? 12 : 12
  if (monthName === 'Adar2') return isLeap ? 13 : 12
  return null
}

/**
 * Map a birth Hebrew month into the equivalent month for a target year,
 * handling Adar / Adar I / Adar II transitions across leap and non-leap
 * years. Shared by age and bar-mitzvah calculations.
 */
export function resolveBirthMonthInTargetYear(
  birthMonth: number,
  birthHebrewYear: number,
  targetHebrewYear: number,
): number {
  const targetIsLeap = HDate.isLeapYear(targetHebrewYear)
  if (birthMonth === 13 && !targetIsLeap) {
    // Adar II → plain Adar when the target year has no second Adar.
    return 12
  }
  if (birthMonth === 12 && HDate.isLeapYear(birthHebrewYear) && targetIsLeap) {
    // Born in Adar I → stay in Adar I.
    return 12
  }
  if (birthMonth === 12 && !HDate.isLeapYear(birthHebrewYear) && targetIsLeap) {
    // Born in plain Adar, celebrating in a leap year → Adar II.
    return 13
  }
  return birthMonth
}

/**
 * Convert Gregorian date to Hebrew date string
 * @param gregorianDate Gregorian date object
 * @returns Hebrew date string in format "DD MMMM YYYY"
 */
export function convertToHebrewDate(gregorianDate: Date): string {
  try {
    const hdate = new HDate(gregorianDate)
    const day = hdate.getDate()
    const month = hdate.getMonth()
    const year = hdate.getFullYear()
    const isLeap = HDate.isLeapYear(year)

    const monthNames: Record<number, string> = {
      1: 'Nisan',
      2: 'Iyar',
      3: 'Sivan',
      4: 'Tammuz',
      5: 'Av',
      6: 'Elul',
      7: 'Tishrei',
      8: 'Cheshvan',
      9: 'Kislev',
      10: 'Tevet',
      11: 'Shevat',
      // 12 is Adar in a regular year, Adar I in a leap year. 13 only
      // exists in a leap year and is Adar II.
      12: isLeap ? 'Adar I' : 'Adar',
      13: 'Adar II',
    }

    const monthName = monthNames[month] || ''
    return `${day} ${monthName} ${year}`
  } catch (error) {
    console.error('Error converting to Hebrew date:', error)
    return ''
  }
}

/**
 * Parse "DD MMMM YYYY" Hebrew date strings, including multi-word months
 * like "Adar I" and "Adar II".
 */
function parseHebrewDateString(
  hebrewBirthDateString: string,
): { day: number; monthName: string; year: number } | null {
  const parts = hebrewBirthDateString.trim().split(/\s+/)
  if (parts.length < 3) return null
  const day = parseInt(parts[0], 10)
  const year = parseInt(parts[parts.length - 1], 10)
  const monthName = parts.slice(1, -1).join(' ')
  if (!Number.isFinite(day) || !Number.isFinite(year) || !monthName) return null
  return { day, monthName, year }
}

/**
 * Calculate Hebrew age from Hebrew birth date
 * @param hebrewBirthDateString Format: "DD MMMM YYYY" (e.g., "15 Tishrei 5785")
 * @returns Hebrew age in years
 */
export function calculateHebrewAge(hebrewBirthDateString: string): number | null {
  try {
    const parsed = parseHebrewDateString(hebrewBirthDateString)
    if (!parsed) return null

    const { day, monthName, year } = parsed
    const month = resolveHebrewMonth(monthName, year)
    if (!month) return null

    const today = new HDate()
    const currentHebrewYear = today.getFullYear()
    let age = currentHebrewYear - year

    // Re-resolve the birthday month for the *current* Hebrew year — a
    // child born in Adar II of a leap year celebrates in plain Adar
    // during non-leap years. Using the birth-year month (13) against a
    // non-leap current year throws from HDate or computes the wrong age.
    const birthdayMonthThisYear = resolveBirthMonthInTargetYear(month, year, currentHebrewYear)
    const birthdayThisYear = new HDate(day, birthdayMonthThisYear, currentHebrewYear)
    const todayGreg = today.greg()
    todayGreg.setHours(0, 0, 0, 0)
    const birthdayGreg = birthdayThisYear.greg()
    birthdayGreg.setHours(0, 0, 0, 0)
    if (todayGreg.getTime() < birthdayGreg.getTime()) {
      age--
    }

    return age
  } catch (error) {
    console.error('Error calculating Hebrew age:', error)
    return null
  }
}

/**
 * Calculate Bar/Bat Mitzvah date (13th Hebrew birthday)
 * @param hebrewBirthDateString Format: "DD MMMM YYYY"
 * @returns Gregorian date of 13th Hebrew birthday
 */
export function calculateBarMitzvahDate(hebrewBirthDateString: string): Date | null {
  try {
    const parsed = parseHebrewDateString(hebrewBirthDateString)
    if (!parsed) return null

    const { day, monthName, year } = parsed
    const birthMonth = resolveHebrewMonth(monthName, year)
    if (!birthMonth) return null

    // Calculate 13th Hebrew birthday. Re-resolve the month for the
    // target year — if the bar mitzvah year is a non-leap year and the
    // child was born in Adar II of a leap year, the celebration falls
    // on the same day in Adar (the only Adar that exists that year).
    // Conversely, a non-leap-Adar birth in a leap year is celebrated in
    // Adar II per common Sephardic practice (and matches the
    // resolveHebrewMonth fallback used in calculateHebrewAge).
    const barMitzvahHebrewYear = year + 13
    const barMitzvahMonth = resolveBirthMonthInTargetYear(
      birthMonth,
      year,
      barMitzvahHebrewYear,
    )
    const barMitzvahHebrewDate = new HDate(day, barMitzvahMonth, barMitzvahHebrewYear)
    
    // Convert Hebrew date to Gregorian date
    const gregorianDate = barMitzvahHebrewDate.greg()
    
    return gregorianDate
  } catch (error) {
    console.error('Error calculating Bar Mitzvah date:', error)
    return null
  }
}

/**
 * Check if a child has turned 13 based on Hebrew date
 * @param hebrewBirthDateString Format: "DD MMMM YYYY"
 * @returns true if child is 13 or older in Hebrew years
 */
export function hasReachedBarMitzvahAge(hebrewBirthDateString: string): boolean {
  const age = calculateHebrewAge(hebrewBirthDateString)
  return age !== null && age >= 13
}

/**
 * Format Hebrew date string for display
 * @param hebrewBirthDateString Format: "DD MMMM YYYY"
 * @returns Formatted string
 */
export function formatHebrewDate(hebrewBirthDateString: string): string {
  return hebrewBirthDateString.trim()
}

