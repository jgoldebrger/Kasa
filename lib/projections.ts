// Dues recommendation engine.
//
// The page at /projections answers: "based on roster dates (when lifecycle
// events are expected) and your current payment-plan income, how much should
// each plan cost to cover projected event expenses?"
//
//     scaleFactor[y]       = projectedExpenses[y] / projectedPlanIncome[y]
//     recommendedPrice[p]  = plan.yearlyPrice × scaleFactor[y]
//
//     projectedExpenses[y] = Σ (roster events of type T in year y) × cost(T)
//     projectedPlanIncome[y] = currentPlanIncome × (families[y] / currentFamilies)
//
// No YearlyCalculation snapshots required — expenses come from member/family
// dates bucketed into each forecast year.

import { unstable_cache } from 'next/cache'
import { Types } from 'mongoose'
import connectDB from './database'
import { countMembersByPaymentPlan } from './calculations'
import { Family, FamilyMember, LifecycleEvent, Organization } from './models'
import { calendarYearBoundsInTimeZone, getYearInTimeZone } from './date-utils'
import { loadAllByIdCursor } from './org-pagination'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RosterEventSource = 'bar_mitzvah' | 'bat_mitzvah' | 'member_wedding'

export interface PlanRecommendation {
  planId: string
  planName: string
  currentPrice: number
  familyCount: number
}

export interface YearlyPlanRecommendation extends PlanRecommendation {
  recommendedPrice: number
}

export interface DuesRecommendationEventRow {
  eventTypeId: string
  name: string
  type: string
  currentCost: number
  rosterMapped: boolean
  /** Projected event count in the first forecast year. */
  projectedCountStartYear: number
  projectedExpenseStartYear: number
}

/**
 * One row in the Excel-style year-by-year breakdown.
 */
export interface YearlyDuesRow {
  year: number
  projectedFamilies: number
  projectedBarMitzvahPayers: number
  projectedPayers: number
  projectedExpenses: number
  projectedPlanIncome: number
  scaleFactor: number
  planRecommendations: YearlyPlanRecommendation[]
}

export interface DuesRecommendation {
  plans: PlanRecommendation[]
  currentPlanIncome: number
  expenseSource: 'roster'
  currentPayers: number
  currentFamilies: number
  currentBarMitzvahPayers: number
  avgNewFamiliesPerYear: number
  avgNewBarMitzvahsPerYear: number
  projectedNewPayersPerYear: number
  projectedPayers: number
  chargesBarMitzvahPayers: boolean
  growthLookbackYears: number
  perEvent: DuesRecommendationEventRow[]
  multiYear: YearlyDuesRow[]
}

/** Default forward-projection horizon for the Excel-style table. */
export const DEFAULT_DUES_FORECAST_YEARS = 20

export interface EventTypeConfig {
  eventTypeId: string
  type: string
  name: string
  currentCost: number
  rosterSource: RosterEventSource | null
}

export interface DuesRecommendationInput {
  currentFamilies: number
  currentBarMitzvahPayers: number
  avgNewFamiliesPerYear: number
  avgNewBarMitzvahsPerYear: number
  chargesBarMitzvahPayers: boolean
  growthLookbackYears: number
  plans: PlanRecommendation[]
  currentPlanIncome: number
  expensesByYear: number[]
  eventTypes: Array<EventTypeConfig & { projectedCountByYear: number[] }>
}

export interface RosterCountsByYear {
  barMitzvah: Map<number, number>
  batMitzvah: Map<number, number>
  memberWedding: Map<number, number>
}

// ---------------------------------------------------------------------------
// Roster mapping (pure)
// ---------------------------------------------------------------------------

const BAR_MITZVAH_SLUG = /bar[_\s-]?mitzvah|barmitzvah/
const BAT_MITZVAH_SLUG = /bat[_\s-]?mitzvah|batmitzvah/
const WEDDING_SLUG = /wedding|chasuna|kiddushin|chasan/

function slugMatches(type: string, pattern: RegExp): boolean {
  return pattern.test(type.toLowerCase().replace(/\s+/g, ''))
}

/**
 * Assign each lifecycle event type to at most one roster date source.
 * Explicit org automation IDs take precedence over slug heuristics.
 */
export function mapEventTypesToRoster(
  eventTypes: Array<{ eventTypeId: string; type: string }>,
  barMitzvahAutoCreateEventTypeId: string | null,
): Map<string, RosterEventSource | null> {
  const assigned = new Map<string, RosterEventSource | null>()
  const usedSources = new Set<RosterEventSource>()

  if (barMitzvahAutoCreateEventTypeId) {
    const explicit = eventTypes.find((e) => e.eventTypeId === barMitzvahAutoCreateEventTypeId)
    if (explicit) {
      assigned.set(explicit.eventTypeId, 'bar_mitzvah')
      usedSources.add('bar_mitzvah')
    }
  }

  for (const e of eventTypes) {
    if (assigned.has(e.eventTypeId)) continue
    let source: RosterEventSource | null = null
    if (!usedSources.has('bar_mitzvah') && slugMatches(e.type, BAR_MITZVAH_SLUG)) {
      source = 'bar_mitzvah'
    } else if (!usedSources.has('bat_mitzvah') && slugMatches(e.type, BAT_MITZVAH_SLUG)) {
      source = 'bat_mitzvah'
    } else if (!usedSources.has('member_wedding') && slugMatches(e.type, WEDDING_SLUG)) {
      source = 'member_wedding'
    }
    if (source) {
      assigned.set(e.eventTypeId, source)
      usedSources.add(source)
    } else {
      assigned.set(e.eventTypeId, null)
    }
  }

  return assigned
}

function countForSource(
  roster: RosterCountsByYear,
  source: RosterEventSource | null,
  year: number,
): number {
  if (!source) return 0
  switch (source) {
    case 'bar_mitzvah':
      return roster.barMitzvah.get(year) ?? 0
    case 'bat_mitzvah':
      return roster.batMitzvah.get(year) ?? 0
    case 'member_wedding':
      return roster.memberWedding.get(year) ?? 0
    default:
      return 0
  }
}

function aggRowsToMap(rows: Array<{ _id: string; count?: number }>): Map<number, number> {
  const map = new Map<number, number>()
  for (const row of rows) {
    const year = Number(row._id)
    if (Number.isFinite(year)) {
      map.set(year, row.count ?? 0)
    }
  }
  return map
}

/**
 * Bucket roster dates into per-year event counts and expenses.
 */
export function projectRosterEventsByYear(
  eventTypes: EventTypeConfig[],
  roster: RosterCountsByYear,
  startYear: number,
  years: number,
): {
  expensesByYear: number[]
  eventTypesWithCounts: Array<EventTypeConfig & { projectedCountByYear: number[] }>
} {
  const horizon = Math.max(1, Math.min(50, Math.floor(years)))
  const expensesByYear = new Array<number>(horizon).fill(0)
  const eventTypesWithCounts = eventTypes.map((e) => {
    const projectedCountByYear: number[] = []
    for (let i = 0; i < horizon; i++) {
      const year = startYear + i
      const count = countForSource(roster, e.rosterSource, year)
      projectedCountByYear.push(count)
      expensesByYear[i] += count * e.currentCost
    }
    return { ...e, projectedCountByYear }
  })
  return { expensesByYear, eventTypesWithCounts }
}

// ---------------------------------------------------------------------------
// Pure math (no DB) — easy to unit-test
// ---------------------------------------------------------------------------

/**
 * Year-by-year breakdown with proportional plan scaling.
 */
export function projectDuesMultiYear(
  input: DuesRecommendationInput,
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
    const projectedExpenses = input.expensesByYear[i] ?? 0
    const projectedPlanIncome =
      input.currentPlanIncome > 0 && input.currentFamilies > 0
        ? input.currentPlanIncome * (families / input.currentFamilies)
        : 0
    const scaleFactor = projectedPlanIncome > 0 ? projectedExpenses / projectedPlanIncome : 0
    const planRecommendations: YearlyPlanRecommendation[] = input.plans.map((p) => ({
      ...p,
      recommendedPrice: p.currentPrice * scaleFactor,
    }))
    rows.push({
      year: startYear + i,
      projectedFamilies: families,
      projectedBarMitzvahPayers: bm,
      projectedPayers: payers,
      projectedExpenses,
      projectedPlanIncome,
      scaleFactor,
      planRecommendations,
    })
  }
  return rows
}

/**
 * Compute the headline recommendation + the multi-year table.
 */
export function computeDuesRecommendation(
  input: DuesRecommendationInput,
  opts: { startYear?: number; forecastYears?: number } = {},
): DuesRecommendation {
  const startYear = opts.startYear ?? new Date().getFullYear()
  const forecastYears = opts.forecastYears ?? DEFAULT_DUES_FORECAST_YEARS

  const perEvent: DuesRecommendationEventRow[] = input.eventTypes.map((e) => ({
    eventTypeId: e.eventTypeId,
    name: e.name,
    type: e.type,
    currentCost: e.currentCost,
    rosterMapped: e.rosterSource !== null,
    projectedCountStartYear: e.projectedCountByYear[0] ?? 0,
    projectedExpenseStartYear: (e.projectedCountByYear[0] ?? 0) * e.currentCost,
  }))

  const projectedNewPayersPerYear =
    input.avgNewFamiliesPerYear +
    (input.chargesBarMitzvahPayers ? input.avgNewBarMitzvahsPerYear : 0)
  const currentPayers =
    input.currentFamilies + (input.chargesBarMitzvahPayers ? input.currentBarMitzvahPayers : 0)
  const projectedPayers = currentPayers + projectedNewPayersPerYear

  const multiYear = projectDuesMultiYear(input, startYear, forecastYears)

  return {
    plans: input.plans,
    currentPlanIncome: input.currentPlanIncome,
    expenseSource: 'roster',
    currentPayers,
    currentFamilies: input.currentFamilies,
    currentBarMitzvahPayers: input.currentBarMitzvahPayers,
    avgNewFamiliesPerYear: input.avgNewFamiliesPerYear,
    avgNewBarMitzvahsPerYear: input.avgNewBarMitzvahsPerYear,
    projectedNewPayersPerYear,
    projectedPayers,
    chargesBarMitzvahPayers: input.chargesBarMitzvahPayers,
    growthLookbackYears: input.growthLookbackYears,
    perEvent,
    multiYear,
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Revalidate cached projections after 1 hour (see docs/PERFORMANCE.md). */
export const DUES_RECOMMENDATION_CACHE_SECONDS = 3600

async function loadRosterCountsByYear(
  orgFilter: Record<string, unknown>,
  tz: string,
  startYear: number,
  endYear: number,
): Promise<RosterCountsByYear> {
  const rangeStart = calendarYearBoundsInTimeZone(startYear, tz).start
  const rangeEnd = calendarYearBoundsInTimeZone(endYear + 1, tz).start
  const yearBucket = (field: string) => ({
    $dateToString: { format: '%Y', date: `$${field}`, timezone: tz },
  })
  const dateInRange = { $gte: rangeStart, $lt: rangeEnd }

  const [barRows, batRows, weddingRows] = await Promise.all([
    FamilyMember.aggregate([
      {
        $match: {
          ...orgFilter,
          gender: 'male',
          convertedToFamily: { $ne: true },
          barMitzvahDate: { $ne: null, ...dateInRange },
        },
      },
      { $group: { _id: yearBucket('barMitzvahDate'), count: { $sum: 1 } } },
    ]),
    FamilyMember.aggregate([
      {
        $match: {
          ...orgFilter,
          convertedToFamily: { $ne: true },
          batMitzvahDate: { $ne: null, ...dateInRange },
        },
      },
      { $group: { _id: yearBucket('batMitzvahDate'), count: { $sum: 1 } } },
    ]),
    FamilyMember.aggregate([
      {
        $match: {
          ...orgFilter,
          convertedToFamily: { $ne: true },
          weddingDate: { $ne: null, ...dateInRange },
        },
      },
      { $group: { _id: yearBucket('weddingDate'), count: { $sum: 1 } } },
    ]),
  ])

  return {
    barMitzvah: aggRowsToMap(barRows),
    batMitzvah: aggRowsToMap(batRows),
    memberWedding: aggRowsToMap(weddingRows),
  }
}

async function loadDuesRecommendationUncached(
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
  const safeHorizon = Math.max(1, Math.min(50, Math.floor(forecastYears)))

  const org = await Organization.findById(new Types.ObjectId(organizationId)).lean<any>()
  const tz = org?.timezone ?? 'UTC'
  const currentYear = getYearInTimeZone(tz)
  const startYear = Number.isFinite(startYearOverride) ? (startYearOverride as number) : currentYear
  const endYear = startYear + safeHorizon - 1

  const oldestYear = currentYear - safeWindow
  const windowStart = calendarYearBoundsInTimeZone(oldestYear, tz).start
  const windowEnd = calendarYearBoundsInTimeZone(currentYear, tz).start
  const yearBucket = (field: string) => ({
    $dateToString: { format: '%Y', date: `$${field}`, timezone: tz },
  })

  const barMitzvahAutoCreateEventTypeId = org?.barMitzvahAutoCreateEventTypeId
    ? String(org.barMitzvahAutoCreateEventTypeId)
    : null

  const [
    eventsRaw,
    currentFamilies,
    currentBarMitzvahPayers,
    newFamilyByYear,
    newBarMitzvahByYear,
    planBreakdown,
    rosterCounts,
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
    countMembersByPaymentPlan(currentYear, organizationId),
    loadRosterCountsByYear(orgFilter, tz, startYear, endYear),
  ])

  const chargesBarMitzvahPayers = !!(org && org.barMitzvahAutoAssignPlanId)

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

  const rosterMapping = mapEventTypesToRoster(
    eventsRaw.map((e: any) => ({ eventTypeId: String(e._id), type: e.type })),
    barMitzvahAutoCreateEventTypeId,
  )

  const eventTypeConfigs: EventTypeConfig[] = eventsRaw.map((e: any) => ({
    eventTypeId: String(e._id),
    type: e.type,
    name: e.name,
    currentCost: e.amount,
    rosterSource: rosterMapping.get(String(e._id)) ?? null,
  }))

  const { expensesByYear, eventTypesWithCounts } = projectRosterEventsByYear(
    eventTypeConfigs,
    rosterCounts,
    startYear,
    safeHorizon,
  )

  const plans: PlanRecommendation[] = planBreakdown.map((p) => ({
    planId: p.planId,
    planName: p.name,
    currentPrice: p.yearlyPrice,
    familyCount: p.familyCount,
  }))
  const currentPlanIncome = planBreakdown.reduce((s, p) => s + p.income, 0)

  return computeDuesRecommendation(
    {
      currentFamilies,
      currentBarMitzvahPayers,
      avgNewFamiliesPerYear,
      avgNewBarMitzvahsPerYear,
      chargesBarMitzvahPayers,
      growthLookbackYears: safeWindow,
      plans,
      currentPlanIncome,
      expensesByYear,
      eventTypes: eventTypesWithCounts,
    },
    { startYear, forecastYears: safeHorizon },
  )
}

const getCachedDuesRecommendation = unstable_cache(
  async (organizationId: string, windowYears: number) =>
    loadDuesRecommendationUncached(organizationId, windowYears),
  ['dues-recommendation-v2'],
  { revalidate: DUES_RECOMMENDATION_CACHE_SECONDS },
)

/**
 * Load roster-based dues recommendation. Results for the default forecast horizon
 * are cached per org + growth lookback for {@link DUES_RECOMMENDATION_CACHE_SECONDS}s.
 * Custom `forecastYears` / `startYearOverride` bypass the cache.
 */
export async function loadDuesRecommendation(
  organizationId: string,
  windowYears = 5,
  forecastYears = DEFAULT_DUES_FORECAST_YEARS,
  startYearOverride?: number,
): Promise<DuesRecommendation> {
  if (forecastYears === DEFAULT_DUES_FORECAST_YEARS && startYearOverride === undefined) {
    return getCachedDuesRecommendation(organizationId, windowYears)
  }
  return loadDuesRecommendationUncached(
    organizationId,
    windowYears,
    forecastYears,
    startYearOverride,
  )
}
