// Dues recommendation + long-run communal fund projection.
//
// Blends roster dates (known future events) with historical averages (payments,
// children, weddings) and projects year-by-year fund balance:
//
//     closingFund[y] = openingFund[y] + projectedPlanIncome[y] − projectedExpenses[y]
//
// Plan recommendations use the greater of the annual expense ratio and the
// uniform solvency scale needed to keep the fund non-negative over the horizon.

import { unstable_cache } from 'next/cache'
import { Types } from 'mongoose'
import connectDB from './database'
import { countLifecycleEvents, countMembersByPaymentPlan } from './calculations'
import {
  Family,
  FamilyMember,
  LifecycleEvent,
  LifecycleEventPayment,
  Organization,
  Payment,
  YearlyCalculation,
} from './models'
import { calendarYearBoundsInTimeZone, getYearInTimeZone } from './date-utils'
import { loadAllByIdCursor } from './org-pagination'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RosterEventSource = 'bar_mitzvah' | 'bat_mitzvah' | 'member_wedding'
export type ExpenseCountSource = 'roster' | 'historical' | 'planned' | 'blended'

export interface PlannedEventYearBucket {
  count: number
  totalAmount: number
}

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
  historicalAvgPerYear: number
  projectedCountStartYear: number
  projectedExpenseStartYear: number
  countSource: ExpenseCountSource
}

export interface YearlyDuesRow {
  year: number
  projectedFamilies: number
  projectedBarMitzvahPayers: number
  projectedPayers: number
  projectedExpenses: number
  projectedPlanIncome: number
  openingFundBalance: number
  closingFundBalance: number
  fundSolvent: boolean
  scaleFactor: number
  planRecommendations: YearlyPlanRecommendation[]
}

export interface DuesRecommendation {
  plans: PlanRecommendation[]
  currentPlanIncome: number
  openingFundBalance: number
  solvencyScaleFactor: number
  avgNewChildrenPerYear: number
  historyYearsWithData: number
  expenseSource: 'blended'
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
  avgNewChildrenPerYear: number
  chargesBarMitzvahPayers: boolean
  growthLookbackYears: number
  openingFundBalance: number
  solvencyScaleFactor: number
  historyYearsWithData: number
  plans: PlanRecommendation[]
  currentPlanIncome: number
  expensesByYear: number[]
  eventTypes: Array<
    EventTypeConfig & {
      historicalAvgPerYear: number
      blendedCountByYear: number[]
      rosterCountStartYear: number
      plannedCountStartYear: number
      plannedAmountStartYear: number
    }
  >
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

export function projectRosterEventsByYear(
  eventTypes: EventTypeConfig[],
  roster: RosterCountsByYear,
  startYear: number,
  years: number,
): {
  rosterCountByYear: Map<string, number[]>
} {
  const horizon = Math.max(1, Math.min(50, Math.floor(years)))
  const rosterCountByYear = new Map<string, number[]>()
  for (const e of eventTypes) {
    const counts: number[] = []
    for (let i = 0; i < horizon; i++) {
      counts.push(countForSource(roster, e.rosterSource, startYear + i))
    }
    rosterCountByYear.set(e.eventTypeId, counts)
  }
  return { rosterCountByYear }
}

/**
 * Per event type per year: max(roster count, historical average, planned payments).
 * Expense uses the higher of (blended count × configured cost) or summed planned amounts.
 */
export function blendEventProjections(
  eventTypes: EventTypeConfig[],
  rosterCountByYear: Map<string, number[]>,
  historicalAvgByEventId: Map<string, number>,
  plannedByTypeAndYear: Map<string, Map<number, PlannedEventYearBucket>>,
  addChildEventTypeId: string | null,
  avgNewChildrenPerYear: number,
  startYear: number,
  years: number,
): {
  expensesByYear: number[]
  eventTypesBlended: Array<
    EventTypeConfig & {
      historicalAvgPerYear: number
      blendedCountByYear: number[]
      rosterCountStartYear: number
      plannedCountStartYear: number
      plannedAmountStartYear: number
    }
  >
} {
  const horizon = Math.max(1, Math.min(50, Math.floor(years)))
  const expensesByYear = new Array<number>(horizon).fill(0)
  const eventTypesBlended = eventTypes.map((e) => {
    const rosterCounts = rosterCountByYear.get(e.eventTypeId) ?? new Array(horizon).fill(0)
    const plannedByYear = plannedByTypeAndYear.get(e.type.toLowerCase()) ?? new Map()
    let historicalAvg = historicalAvgByEventId.get(e.eventTypeId) ?? 0
    if (addChildEventTypeId && e.eventTypeId === addChildEventTypeId) {
      historicalAvg = Math.max(historicalAvg, avgNewChildrenPerYear)
    }
    const blendedCountByYear: number[] = []
    const plannedCountsByYear: number[] = []
    const plannedAmountsByYear: number[] = []
    for (let i = 0; i < horizon; i++) {
      const year = startYear + i
      const planned = plannedByYear.get(year)
      const plannedCount = planned?.count ?? 0
      const plannedAmount = planned?.totalAmount ?? 0
      plannedCountsByYear.push(plannedCount)
      plannedAmountsByYear.push(plannedAmount)
      const rosterCount = rosterCounts[i] ?? 0
      const blendedCount = Math.max(rosterCount, historicalAvg, plannedCount)
      blendedCountByYear.push(blendedCount)
      const expenseFromCount = blendedCount * e.currentCost
      expensesByYear[i] += Math.max(expenseFromCount, plannedAmount)
    }
    return {
      ...e,
      historicalAvgPerYear: historicalAvg,
      blendedCountByYear,
      rosterCountStartYear: rosterCounts[0] ?? 0,
      plannedCountStartYear: plannedCountsByYear[0] ?? 0,
      plannedAmountStartYear: plannedAmountsByYear[0] ?? 0,
    }
  })
  return { expensesByYear, eventTypesBlended }
}

export function countSourceForEvent(
  rosterCount: number,
  historicalAvg: number,
  plannedCount: number,
  blendedCount: number,
): ExpenseCountSource {
  if (blendedCount <= 0) return 'historical'
  if (plannedCount > 0 && plannedCount >= rosterCount && plannedCount >= historicalAvg) {
    return 'planned'
  }
  if (rosterCount >= blendedCount && rosterCount > 0) return 'roster'
  if (historicalAvg >= blendedCount && historicalAvg > 0) return 'historical'
  return 'blended'
}

/** Minimum uniform income multiplier to keep cumulative fund balance ≥ 0. */
export function computeSolvencyScaleFactor(
  openingFundBalance: number,
  incomeByYear: number[],
  expenseByYear: number[],
): number {
  const solvent = (scale: number) => {
    let balance = openingFundBalance
    for (let i = 0; i < incomeByYear.length; i++) {
      balance += incomeByYear[i] * scale - (expenseByYear[i] ?? 0)
      if (balance < -0.005) return false
    }
    return true
  }

  if (solvent(1)) return 1

  let lo = 1
  let hi = 2
  while (!solvent(hi) && hi < 100) hi *= 2
  if (!solvent(hi)) return hi

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (solvent(mid)) hi = mid
    else lo = mid
  }
  return hi
}

// ---------------------------------------------------------------------------
// Pure math (no DB)
// ---------------------------------------------------------------------------

export function projectDuesMultiYear(
  input: DuesRecommendationInput,
  startYear: number,
  years: number,
): YearlyDuesRow[] {
  const horizon = Math.max(1, Math.min(50, Math.floor(years)))
  const rows: YearlyDuesRow[] = []
  let fundBalance = input.openingFundBalance

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

    const openingFundBalance = fundBalance
    fundBalance = openingFundBalance + projectedPlanIncome - projectedExpenses
    const closingFundBalance = fundBalance

    const annualRatio = projectedPlanIncome > 0 ? projectedExpenses / projectedPlanIncome : 0
    const scaleFactor =
      projectedPlanIncome > 0 ? Math.max(annualRatio, input.solvencyScaleFactor) : 0

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
      openingFundBalance,
      closingFundBalance,
      fundSolvent: closingFundBalance >= -0.005,
      scaleFactor,
      planRecommendations,
    })
  }
  return rows
}

export function computeDuesRecommendation(
  input: DuesRecommendationInput,
  opts: { startYear?: number; forecastYears?: number } = {},
): DuesRecommendation {
  const startYear = opts.startYear ?? new Date().getFullYear()
  const forecastYears = opts.forecastYears ?? DEFAULT_DUES_FORECAST_YEARS

  const perEvent: DuesRecommendationEventRow[] = input.eventTypes.map((e) => {
    const blendedStart = e.blendedCountByYear[0] ?? 0
    const expenseFromCount = blendedStart * e.currentCost
    return {
      eventTypeId: e.eventTypeId,
      name: e.name,
      type: e.type,
      currentCost: e.currentCost,
      rosterMapped: e.rosterSource !== null,
      historicalAvgPerYear: e.historicalAvgPerYear,
      projectedCountStartYear: blendedStart,
      projectedExpenseStartYear: Math.max(expenseFromCount, e.plannedAmountStartYear),
      countSource: countSourceForEvent(
        e.rosterCountStartYear,
        e.historicalAvgPerYear,
        e.plannedCountStartYear,
        blendedStart,
      ),
    }
  })

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
    openingFundBalance: input.openingFundBalance,
    solvencyScaleFactor: input.solvencyScaleFactor,
    avgNewChildrenPerYear: input.avgNewChildrenPerYear,
    historyYearsWithData: input.historyYearsWithData,
    expenseSource: 'blended',
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
// Loader helpers
// ---------------------------------------------------------------------------

export const DUES_RECOMMENDATION_CACHE_SECONDS = 3600

async function loadHistoricalEventAverages(
  organizationId: string,
  lookbackYears: number,
  currentYear: number,
  eventTypes: EventTypeConfig[],
): Promise<{ averages: Map<string, number>; yearsQueried: number }> {
  const averages = new Map<string, number>()
  for (const e of eventTypes) averages.set(e.eventTypeId, 0)

  const oldestYear = currentYear - lookbackYears
  let yearsQueried = 0
  for (let year = oldestYear; year < currentYear; year++) {
    yearsQueried += 1
    const counts = await countLifecycleEvents(year, organizationId)
    for (const row of counts) {
      const config = eventTypes.find((e) => e.type === row.type)
      if (config) {
        averages.set(config.eventTypeId, (averages.get(config.eventTypeId) ?? 0) + (row.count ?? 0))
      }
    }
  }

  const divisor = Math.max(lookbackYears, 1)
  for (const [id, sum] of averages) {
    averages.set(id, sum / divisor)
  }
  return { averages, yearsQueried }
}

async function loadOpeningFundBalance(organizationId: string, startYear: number): Promise<number> {
  const orgOid = new Types.ObjectId(organizationId)
  const snapshots = await YearlyCalculation.find({
    organizationId: orgOid,
    year: { $lt: startYear },
  })
    .select('calculatedIncome calculatedExpenses balance year')
    .lean<Array<{ calculatedIncome?: number; calculatedExpenses?: number; balance?: number }>>()

  if (snapshots.length > 0) {
    return snapshots.reduce((sum, doc) => {
      const income = doc.calculatedIncome ?? 0
      const expenses = doc.calculatedExpenses ?? 0
      return sum + (income - expenses)
    }, 0)
  }

  const notDeleted = { organizationId: orgOid, deletedAt: null }
  const [paymentRows, eventRows] = await Promise.all([
    Payment.aggregate([
      { $match: { ...notDeleted, year: { $lt: startYear, $ne: null } } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $max: [
                0,
                {
                  $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$refundedAmount', 0] }],
                },
              ],
            },
          },
        },
      },
    ]),
    LifecycleEventPayment.aggregate([
      { $match: { ...notDeleted, year: { $lt: startYear, $ne: null } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } },
    ]),
  ])

  const payments = Number(paymentRows[0]?.total ?? 0)
  const payouts = Number(eventRows[0]?.total ?? 0)
  return payments - payouts
}

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

/** Planned lifecycle event payments in the forecast window, by event type and year. */
async function loadPlannedEventsByYear(
  orgFilter: Record<string, unknown>,
  tz: string,
  startYear: number,
  endYear: number,
): Promise<Map<string, Map<number, PlannedEventYearBucket>>> {
  const rangeStart = calendarYearBoundsInTimeZone(startYear, tz).start
  const rangeEnd = calendarYearBoundsInTimeZone(endYear + 1, tz).start
  const yearBucket = (field: string) => ({
    $dateToString: { format: '%Y', date: `$${field}`, timezone: tz },
  })

  const rows = await LifecycleEventPayment.aggregate([
    {
      $match: {
        ...orgFilter,
        eventDate: { $gte: rangeStart, $lt: rangeEnd },
      },
    },
    {
      $group: {
        _id: {
          type: { $toLower: { $ifNull: ['$eventType', ''] } },
          year: yearBucket('eventDate'),
        },
        count: { $sum: 1 },
        totalAmount: { $sum: { $ifNull: ['$amount', 0] } },
      },
    },
  ])

  const result = new Map<string, Map<number, PlannedEventYearBucket>>()
  for (const row of rows) {
    const type = String(row._id?.type ?? '').toLowerCase()
    const year = Number(row._id?.year)
    if (!type || !Number.isFinite(year)) continue
    let byYear = result.get(type)
    if (!byYear) {
      byYear = new Map()
      result.set(type, byYear)
    }
    byYear.set(year, {
      count: row.count ?? 0,
      totalAmount: row.totalAmount ?? 0,
    })
  }
  return result
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
  const addChildEventTypeId = org?.addChildAutoCreateEventTypeId
    ? String(org.addChildAutoCreateEventTypeId)
    : null

  const [
    eventsRaw,
    currentFamilies,
    currentBarMitzvahPayers,
    newFamilyByYear,
    newBarMitzvahByYear,
    newChildrenByYear,
    planBreakdown,
    rosterCounts,
    openingFundBalance,
    plannedByTypeAndYear,
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
    FamilyMember.aggregate([
      {
        $match: {
          ...orgFilter,
          createdAt: { $gte: windowStart, $lt: windowEnd },
          convertedToFamily: { $ne: true },
        },
      },
      { $group: { _id: yearBucket('createdAt'), count: { $sum: 1 } } },
    ]),
    countMembersByPaymentPlan(currentYear, organizationId),
    loadRosterCountsByYear(orgFilter, tz, startYear, endYear),
    loadOpeningFundBalance(organizationId, startYear),
    loadPlannedEventsByYear(orgFilter, tz, startYear, endYear),
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
  const sumNewChildren = (newChildrenByYear as Array<{ count: number }>).reduce(
    (s, r) => s + (r.count ?? 0),
    0,
  )
  const avgNewFamiliesPerYear = sumNewFamilies / safeWindow
  const avgNewBarMitzvahsPerYear = sumNewBarMitzvahs / safeWindow
  const avgNewChildrenPerYear = sumNewChildren / safeWindow

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

  const { averages: historicalAvgByEventId, yearsQueried } = await loadHistoricalEventAverages(
    organizationId,
    safeWindow,
    currentYear,
    eventTypeConfigs,
  )

  const { rosterCountByYear } = projectRosterEventsByYear(
    eventTypeConfigs,
    rosterCounts,
    startYear,
    safeHorizon,
  )

  const { expensesByYear, eventTypesBlended } = blendEventProjections(
    eventTypeConfigs,
    rosterCountByYear,
    historicalAvgByEventId,
    plannedByTypeAndYear,
    addChildEventTypeId,
    avgNewChildrenPerYear,
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

  const previewInput: DuesRecommendationInput = {
    currentFamilies,
    currentBarMitzvahPayers,
    avgNewFamiliesPerYear,
    avgNewBarMitzvahsPerYear,
    avgNewChildrenPerYear,
    chargesBarMitzvahPayers,
    growthLookbackYears: safeWindow,
    openingFundBalance,
    solvencyScaleFactor: 1,
    historyYearsWithData: yearsQueried,
    plans,
    currentPlanIncome,
    expensesByYear,
    eventTypes: eventTypesBlended,
  }

  const previewRows = projectDuesMultiYear(previewInput, startYear, safeHorizon)
  const incomeByYear = previewRows.map((r) => r.projectedPlanIncome)
  const solvencyScaleFactor = computeSolvencyScaleFactor(
    openingFundBalance,
    incomeByYear,
    expensesByYear,
  )

  return computeDuesRecommendation(
    { ...previewInput, solvencyScaleFactor },
    { startYear, forecastYears: safeHorizon },
  )
}

const getCachedDuesRecommendation = unstable_cache(
  async (organizationId: string, windowYears: number) =>
    loadDuesRecommendationUncached(organizationId, windowYears),
  ['dues-recommendation-v4'],
  { revalidate: DUES_RECOMMENDATION_CACHE_SECONDS },
)

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
