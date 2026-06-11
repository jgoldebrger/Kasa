// Dues recommendation engine.
//
// One async loader + a small handful of pure functions. The page at
// /projections asks one question and this file answers it: "based on the
// historical average of lifecycle events (expense side) and the historical
// average of new payers (income side), what must each family — and each
// bar-mitzvah-aged male, when the org charges them separately — pay this
// year to break even?"
//
//     recommendedDues = expectedEventExpenses / projectedPayers
//
//     expectedEventExpenses = Σ(event types) historicalAvgCount × currentCost
//     projectedPayers       = currentFamilies + avgNewFamiliesPerYear
//                             [+ currentBarMitzvahMembers + avgNewBarMitzvahsPerYear
//                              if org has barMitzvahAutoAssignPlanId set]
//
// The Excel-style breakdown rolls that forward year by year, growing the
// payer base linearly and recomputing dues against the new base each year.
// No churn, no inflation, no compounding — keeps the math honest with the
// "average from history" framing.

import { Types } from 'mongoose'
import connectDB from './database'
import {
  Family,
  FamilyMember,
  LifecycleEvent,
  Organization,
  YearlyCalculation,
} from './models'
import { calendarYearBoundsInTimeZone, getYearInTimeZone } from './date-utils'
import { loadAllByIdCursor } from './org-pagination'
import { collectCompoundCursorPages } from './pagination'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of a YearlyCalculation document used for historical-event averaging.
 * Defined as a separate interface so the loader can `.lean<YearlyCalculationLean[]>()`
 * without dragging in mongoose Document plumbing.
 */
export interface YearlyCalculationLean {
  _id: unknown
  year: number
  byPlan?: Array<{ planNumber: number; name?: string; count?: number; income?: number }>
  byEvent?: Array<{ type: string; name?: string; count?: number; amount?: number }>
}

export interface DuesRecommendationEventRow {
  eventTypeId: string
  name: string
  type: string
  historicalAvgCount: number
  historicalSampleSize: number
  currentCost: number
  expectedExpense: number
}

/**
 * One row in the Excel-style year-by-year breakdown.
 */
export interface YearlyDuesRow {
  year: number
  projectedFamilies: number
  projectedBarMitzvahPayers: number
  projectedPayers: number
  expectedEventExpense: number
  recommendedDuesPerPayer: number
}

export interface DuesRecommendation {
  recommendedDuesPerPayer: number
  expectedAnnualEventExpense: number
  currentPayers: number
  currentFamilies: number
  currentBarMitzvahPayers: number
  avgNewFamiliesPerYear: number
  avgNewBarMitzvahsPerYear: number
  projectedNewPayersPerYear: number
  projectedPayers: number
  chargesBarMitzvahPayers: boolean
  historyWindowYears: number
  historyYearsSeen: number
  perEvent: DuesRecommendationEventRow[]
  multiYear: YearlyDuesRow[]
}

/** Default forward-projection horizon for the Excel-style table. */
export const DEFAULT_DUES_FORECAST_YEARS = 20

export interface DuesRecommendationInput {
  currentFamilies: number
  currentBarMitzvahPayers: number
  avgNewFamiliesPerYear: number
  avgNewBarMitzvahsPerYear: number
  chargesBarMitzvahPayers: boolean
  historyWindowYears: number
  historyYearsSeen: number
  eventTypes: Array<{
    eventTypeId: string
    type: string
    name: string
    currentCost: number
    historicalAvgCount: number
    historicalSampleSize: number
  }>
}

// ---------------------------------------------------------------------------
// Pure math (no DB) — easy to unit-test
// ---------------------------------------------------------------------------

/**
 * Year-by-year breakdown. For year `i` (starting at 0 = startYear):
 *
 *     families[i]      = currentFamilies + avgNewFamiliesPerYear * i
 *     bm_payers[i]     = currentBarMitzvahPayers + avgNewBarMitzvahsPerYear * i
 *                          (or 0 if the org doesn't charge them)
 *     total[i]         = families[i] + bm_payers[i]
 *     dues_per_payer[i] = expectedAnnualEventExpense / total[i]
 *
 * Linear growth + constant expenses is intentional: matches the "average from
 * history × number of payers" framing without sneaking in inflation or churn.
 * Horizon is clamped to [1, 50].
 */
export function projectDuesMultiYear(
  input: DuesRecommendationInput,
  expectedAnnualEventExpense: number,
  startYear: number,
  years: number,
): YearlyDuesRow[] {
  const horizon = Math.max(1, Math.min(50, Math.floor(years)))
  const rows: YearlyDuesRow[] = []
  for (let i = 0; i < horizon; i++) {
    const families = input.currentFamilies + input.avgNewFamiliesPerYear * i
    const bm = input.chargesBarMitzvahPayers
      ? input.currentBarMitzvahPayers + input.avgNewBarMitzvahsPerYear * i
      : 0
    const payers = families + bm
    const dues = payers > 0 ? expectedAnnualEventExpense / payers : 0
    rows.push({
      year: startYear + i,
      projectedFamilies: families,
      projectedBarMitzvahPayers: bm,
      projectedPayers: payers,
      expectedEventExpense: expectedAnnualEventExpense,
      recommendedDuesPerPayer: dues,
    })
  }
  return rows
}

/**
 * Compute the headline recommendation + the multi-year table. The loader
 * below feeds this; tests construct inputs directly.
 */
export function computeDuesRecommendation(
  input: DuesRecommendationInput,
  opts: { startYear?: number; forecastYears?: number } = {},
): DuesRecommendation {
  const perEvent: DuesRecommendationEventRow[] = input.eventTypes.map((e) => ({
    eventTypeId: e.eventTypeId,
    name: e.name,
    type: e.type,
    historicalAvgCount: e.historicalAvgCount,
    historicalSampleSize: e.historicalSampleSize,
    currentCost: e.currentCost,
    expectedExpense: e.historicalAvgCount * e.currentCost,
  }))
  const expectedAnnualEventExpense = perEvent.reduce((s, r) => s + r.expectedExpense, 0)

  const projectedNewPayersPerYear =
    input.avgNewFamiliesPerYear +
    (input.chargesBarMitzvahPayers ? input.avgNewBarMitzvahsPerYear : 0)
  const currentPayers =
    input.currentFamilies +
    (input.chargesBarMitzvahPayers ? input.currentBarMitzvahPayers : 0)
  const projectedPayers = currentPayers + projectedNewPayersPerYear

  // Guard against divide-by-zero. With nobody to charge, "infinity" is
  // useless; surface 0 so the UI can render a "no payers" empty state
  // instead of NaN.
  const recommendedDuesPerPayer =
    projectedPayers > 0 ? expectedAnnualEventExpense / projectedPayers : 0

  const startYear = opts.startYear ?? new Date().getFullYear()
  const forecastYears = opts.forecastYears ?? DEFAULT_DUES_FORECAST_YEARS
  const multiYear = projectDuesMultiYear(
    input,
    expectedAnnualEventExpense,
    startYear,
    forecastYears,
  )

  return {
    recommendedDuesPerPayer,
    expectedAnnualEventExpense,
    currentPayers,
    currentFamilies: input.currentFamilies,
    currentBarMitzvahPayers: input.currentBarMitzvahPayers,
    avgNewFamiliesPerYear: input.avgNewFamiliesPerYear,
    avgNewBarMitzvahsPerYear: input.avgNewBarMitzvahsPerYear,
    projectedNewPayersPerYear,
    projectedPayers,
    chargesBarMitzvahPayers: input.chargesBarMitzvahPayers,
    historyWindowYears: input.historyWindowYears,
    historyYearsSeen: input.historyYearsSeen,
    perEvent,
    multiYear,
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Pulls org config, event types, current member counts, and gross year-by-year
 * history of new families + bar-mitzvah arrivals from the DB.
 *
 *   - "Gross new families per year" = count of Family.createdAt by year.
 *     Soft-deleted families are excluded by the soft-delete plugin's filter,
 *     which is the correct behaviour: a family that joined and was hard-removed
 *     shouldn't pad future-year expectations.
 *   - "Gross new bar mitzvahs per year" = count of FamilyMember.barMitzvahDate
 *     falling in the year. Only meaningful when `org.barMitzvahAutoAssignPlanId`
 *     is set — otherwise those members don't become independent payers.
 *   - Event averages exclude snapshot years that are "stale" (no byPlan and no
 *     byEvent rows), so a year where the admin never ran "Calculate Year"
 *     doesn't drag averages down.
 */
export async function loadDuesRecommendation(
  organizationId: string,
  windowYears = 5,
  forecastYears = DEFAULT_DUES_FORECAST_YEARS,
  startYearOverride?: number,
): Promise<DuesRecommendation> {
  await connectDB()
  const orgFilter = {
    organizationId: new Types.ObjectId(organizationId),
    deletedAt: null,
  }
  const safeWindow = Math.max(1, Math.min(10, Math.floor(windowYears)))

  const org = await Organization.findById(new Types.ObjectId(organizationId)).lean<any>()
  const tz = org?.timezone ?? 'UTC'
  const currentYear = getYearInTimeZone(tz)
  // History window covers [oldestYear .. currentYear - 1]; the current
  // partial year is excluded so half-finished years don't drag averages down.
  const oldestYear = currentYear - safeWindow
  const windowStart = calendarYearBoundsInTimeZone(oldestYear, tz).start
  const windowEnd = calendarYearBoundsInTimeZone(currentYear, tz).start // exclusive
  const yearBucket = (field: string) => ({
    $dateToString: { format: '%Y', date: `$${field}`, timezone: tz },
  })

  const [
    eventsRaw,
    currentFamilies,
    currentBarMitzvahPayers,
    newFamilyByYear,
    newBarMitzvahByYear,
    historyRaw,
  ] = await Promise.all([
    loadAllByIdCursor<any>(
      (filter, limit) =>
        LifecycleEvent.find(filter).sort({ name: 1, _id: 1 }).limit(limit).lean<any[]>(),
      orgFilter,
    ),
    Family.countDocuments(orgFilter),
    FamilyMember.countDocuments({
      ...orgFilter,
      gender: 'male',
      convertedToFamily: { $ne: true },
      // "Currently a paying bar-mitzvah-aged member" = the
      // bar-mitzvah has already happened (any non-null date in the
      // past) AND they have an explicit payment plan assigned. The
      // earlier filter clamped to `< windowEnd` (Jan 1 of currentYear),
      // which silently excluded every kid whose bar mitzvah fell
      // inside the partially-completed current year — they're current
      // payers but were being treated as "future" payers for
      // projections, undercounting `currentBarMitzvahPayers` and
      // over-projecting per-payer dues.
      barMitzvahDate: { $ne: null, $lte: new Date() },
      paymentPlanId: { $ne: null },
    }),
    Family.aggregate([
      { $match: { ...orgFilter, createdAt: { $gte: windowStart, $lt: windowEnd } } },
      { $group: { _id: yearBucket('createdAt'), count: { $sum: 1 } } },
    ]),
    FamilyMember.aggregate([
      {
        $match: {
          ...orgFilter,
          gender: 'male',
          barMitzvahDate: { $gte: windowStart, $lt: windowEnd },
          convertedToFamily: { $ne: true },
        },
      },
      { $group: { _id: yearBucket('barMitzvahDate'), count: { $sum: 1 } } },
    ]),
    collectCompoundCursorPages<YearlyCalculationLean>(
      (filter, limit) =>
        YearlyCalculation.find(filter)
          .sort({ year: -1, _id: -1 })
          .limit(limit)
          .lean()
          .exec() as Promise<YearlyCalculationLean[]>,
      { ...orgFilter, year: { $gte: oldestYear, $lt: currentYear } },
      'year',
      -1,
      (last) => ({
        v: Number(last.year),
        id: String(last._id),
      }),
    ),
  ])

  const chargesBarMitzvahPayers = !!(org && org.barMitzvahAutoAssignPlanId)

  // Average over the window, treating missing years as 0 (the absence of
  // any new families in 2022 is real signal, not missing data — Family is
  // a master table, not an event log).
  const sumNewFamilies = (newFamilyByYear as Array<{ count: number }>).reduce(
    (s, r) => s + (r.count ?? 0),
    0,
  )
  const sumNewBarMitzvahs = (newBarMitzvahByYear as Array<{ count: number }>).reduce(
    (s, r) => s + (r.count ?? 0),
    0,
  )
  const avgNewFamiliesPerYear = sumNewFamilies / safeWindow
  const avgNewBarMitzvahsPerYear = sumNewBarMitzvahs / safeWindow

  const historyForAvg = historyRaw.filter(isNonStaleSnapshot)

  const eventTypes = eventsRaw.map((e: any) => {
    let cumulative = 0
    let contributing = 0
    for (const snap of historyForAvg) {
      const hit = (snap.byEvent ?? []).find((b) => b.type === e.type)
      if (hit) {
        cumulative += hit.count ?? 0
        contributing += 1
      }
    }
    // Average across the full observation window, not just the years
    // that happened to have at least one occurrence. Dividing by
    // `contributing` over-states how often rare events happen — a
    // bar mitzvah that occurred once in five years would yield an
    // average of 1/year instead of 0.2/year, and the projections panel
    // would over-collect dues by ~5×.
    const windowYears = Math.max(historyForAvg.length, 1)
    const historicalAvgCount = cumulative / windowYears
    return {
      eventTypeId: String(e._id),
      type: e.type,
      name: e.name,
      currentCost: e.amount,
      historicalAvgCount,
      historicalSampleSize: contributing,
    }
  })

  return computeDuesRecommendation(
    {
      currentFamilies,
      currentBarMitzvahPayers,
      avgNewFamiliesPerYear,
      avgNewBarMitzvahsPerYear,
      chargesBarMitzvahPayers,
      historyWindowYears: safeWindow,
      historyYearsSeen: historyForAvg.length,
      eventTypes,
    },
    {
      startYear:
        Number.isFinite(startYearOverride) ? (startYearOverride as number) : currentYear,
      forecastYears,
    },
  )
}

function isNonStaleSnapshot(snap: YearlyCalculationLean): boolean {
  const hasPlan = (snap.byPlan?.length ?? 0) > 0
  const hasEvent = (snap.byEvent?.length ?? 0) > 0
  return hasPlan || hasEvent
}
