import { beforeEach, describe, expect, it, vi } from 'vitest'

const loaderMocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  orgLean: vi.fn(
    async () => ({ timezone: 'UTC', barMitzvahAutoAssignPlanId: null }) as Record<string, unknown>,
  ),
  lifecycleEvents: [] as Array<{ _id: string; type: string; name: string; amount: number }>,
  familyCount: 50,
  bmCount: 0,
  newFamiliesAgg: [] as Array<{ count: number }>,
  newBmAgg: [] as Array<{ count: number }>,
  historySnaps: [] as Array<{
    year: number
    byPlan?: Array<{ planNumber: number }>
    byEvent?: Array<{ type: string; count?: number }>
  }>,
}))

vi.mock('./database', () => ({ default: loaderMocks.connectDB }))
vi.mock('./org-pagination', () => ({
  loadAllByIdCursor: vi.fn(async () => loaderMocks.lifecycleEvents),
}))
vi.mock('./pagination', () => ({
  collectCompoundCursorPages: vi.fn(async () => loaderMocks.historySnaps),
}))
vi.mock('./models', () => ({
  Organization: {
    findById: vi.fn(() => ({ lean: loaderMocks.orgLean })),
  },
  Family: {
    countDocuments: vi.fn(async () => loaderMocks.familyCount),
    aggregate: vi.fn(async () => loaderMocks.newFamiliesAgg),
  },
  FamilyMember: {
    countDocuments: vi.fn(async () => loaderMocks.bmCount),
    aggregate: vi.fn(async () => loaderMocks.newBmAgg),
  },
  LifecycleEvent: {},
  YearlyCalculation: {},
}))

import {
  computeDuesRecommendation,
  DEFAULT_DUES_FORECAST_YEARS,
  loadDuesRecommendation,
  projectDuesMultiYear,
  type DuesRecommendationInput,
} from './projections'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a baseline DuesRecommendationInput that callers can override piece-
 * meal. Defaults model a small synagogue with two recurring event types and
 * a modest steady flow of new families.
 */
function recInput(over: Partial<DuesRecommendationInput> = {}): DuesRecommendationInput {
  return {
    currentFamilies: 50,
    currentBarMitzvahPayers: 0,
    avgNewFamiliesPerYear: 2,
    avgNewBarMitzvahsPerYear: 0,
    chargesBarMitzvahPayers: false,
    historyWindowYears: 5,
    historyYearsSeen: 3,
    eventTypes: [
      {
        eventTypeId: 'wed',
        type: 'wedding',
        name: 'Wedding',
        currentCost: 300,
        historicalAvgCount: 4,
        historicalSampleSize: 3,
      },
      {
        eventTypeId: 'bar',
        type: 'barmitzvah',
        name: 'Bar Mitzvah',
        currentCost: 500,
        historicalAvgCount: 2,
        historicalSampleSize: 3,
      },
    ],
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Single-year recommendation
// ---------------------------------------------------------------------------

describe('computeDuesRecommendation — break-even math', () => {
  it('divides expected expenses by current + new payers', () => {
    const out = computeDuesRecommendation(recInput())
    // expenses: 4*300 + 2*500 = 2200
    expect(out.expectedAnnualEventExpense).toBe(2200)
    // payers: 50 + 2 = 52
    expect(out.projectedPayers).toBe(52)
    // dues: 2200 / 52
    expect(out.recommendedDuesPerPayer).toBeCloseTo(2200 / 52, 6)
  })

  it('counts bar-mitzvah payers when the org opts in', () => {
    const out = computeDuesRecommendation(
      recInput({
        chargesBarMitzvahPayers: true,
        currentBarMitzvahPayers: 5,
        avgNewBarMitzvahsPerYear: 3,
      }),
    )
    // payers: 50 + 5 + 2 + 3 = 60
    expect(out.currentPayers).toBe(55)
    expect(out.projectedNewPayersPerYear).toBe(5)
    expect(out.projectedPayers).toBe(60)
    expect(out.recommendedDuesPerPayer).toBeCloseTo(2200 / 60, 6)
  })

  it('ignores bar-mitzvah numbers when the org does NOT opt in', () => {
    const out = computeDuesRecommendation(
      recInput({
        chargesBarMitzvahPayers: false,
        currentBarMitzvahPayers: 5,
        avgNewBarMitzvahsPerYear: 3,
      }),
    )
    expect(out.currentPayers).toBe(50)
    expect(out.projectedNewPayersPerYear).toBe(2)
    expect(out.projectedPayers).toBe(52)
    expect(out.recommendedDuesPerPayer).toBeCloseTo(2200 / 52, 6)
  })

  it('returns 0 dues (not NaN) when there are no payers at all', () => {
    const out = computeDuesRecommendation(
      recInput({ currentFamilies: 0, avgNewFamiliesPerYear: 0 }),
    )
    expect(out.recommendedDuesPerPayer).toBe(0)
    expect(out.projectedPayers).toBe(0)
  })

  it('returns 0 expense and 0 dues with no event types', () => {
    const out = computeDuesRecommendation(recInput({ eventTypes: [] }))
    expect(out.expectedAnnualEventExpense).toBe(0)
    expect(out.recommendedDuesPerPayer).toBe(0)
  })

  it('per-event rows expose the full breakdown', () => {
    const out = computeDuesRecommendation(recInput())
    expect(out.perEvent).toHaveLength(2)
    expect(out.perEvent[0].expectedExpense).toBe(1200) // 4 * 300
    expect(out.perEvent[1].expectedExpense).toBe(1000) // 2 * 500
  })
})

// ---------------------------------------------------------------------------
// Multi-year breakdown
// ---------------------------------------------------------------------------

describe('computeDuesRecommendation — multi-year breakdown', () => {
  it('grows the payer base linearly and shrinks dues accordingly', () => {
    const out = computeDuesRecommendation(recInput(), {
      startYear: 2026,
      forecastYears: 5,
    })
    expect(out.multiYear).toHaveLength(5)
    expect(out.multiYear[0].year).toBe(2026)
    expect(out.multiYear[4].year).toBe(2030)
    // Year 0: 50 families, no new yet → 50 payers, $2,200 / 50 = $44
    expect(out.multiYear[0].projectedPayers).toBe(50)
    expect(out.multiYear[0].recommendedDuesPerPayer).toBe(44)
    // Year 4: 50 + 2 * 4 = 58 payers → $2,200 / 58 ≈ $37.93
    expect(out.multiYear[4].projectedPayers).toBe(58)
    expect(out.multiYear[4].recommendedDuesPerPayer).toBeCloseTo(2200 / 58, 6)
    // Expenses constant by design (no inflation)
    expect(out.multiYear[0].expectedEventExpense).toBe(2200)
    expect(out.multiYear[4].expectedEventExpense).toBe(2200)
  })

  it('includes bar-mitzvah growth when the org charges them', () => {
    const out = computeDuesRecommendation(
      recInput({
        chargesBarMitzvahPayers: true,
        currentBarMitzvahPayers: 5,
        avgNewBarMitzvahsPerYear: 3,
      }),
      { startYear: 2026, forecastYears: 3 },
    )
    // Year 0: 50 + 5 = 55 payers
    expect(out.multiYear[0].projectedFamilies).toBe(50)
    expect(out.multiYear[0].projectedBarMitzvahPayers).toBe(5)
    expect(out.multiYear[0].projectedPayers).toBe(55)
    // Year 2: 50 + 2*2 = 54 families; 5 + 3*2 = 11 BM; total 65
    expect(out.multiYear[2].projectedFamilies).toBe(54)
    expect(out.multiYear[2].projectedBarMitzvahPayers).toBe(11)
    expect(out.multiYear[2].projectedPayers).toBe(65)
  })

  it('defaults to a 20-year horizon when forecastYears is not set', () => {
    const out = computeDuesRecommendation(recInput(), { startYear: 2026 })
    expect(out.multiYear).toHaveLength(20)
    expect(out.multiYear[0].year).toBe(2026)
    expect(out.multiYear[19].year).toBe(2045)
  })

  it('clamps the horizon to [1, 50]', () => {
    const tooLong = computeDuesRecommendation(recInput(), { startYear: 2026, forecastYears: 200 })
    expect(tooLong.multiYear).toHaveLength(50)
    const tooShort = computeDuesRecommendation(recInput(), { startYear: 2026, forecastYears: 0 })
    expect(tooShort.multiYear).toHaveLength(1)
  })

  it('passes history metadata through unchanged', () => {
    const out = computeDuesRecommendation(recInput({ historyWindowYears: 8, historyYearsSeen: 4 }))
    expect(out.historyWindowYears).toBe(8)
    expect(out.historyYearsSeen).toBe(4)
    expect(out.chargesBarMitzvahPayers).toBe(false)
    expect(out.currentFamilies).toBe(50)
    expect(out.currentBarMitzvahPayers).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// projectDuesMultiYear (direct)
// ---------------------------------------------------------------------------

describe('projectDuesMultiYear', () => {
  it('returns 0 dues when projected payers are zero', () => {
    const rows = projectDuesMultiYear(
      recInput({ currentFamilies: 0, avgNewFamiliesPerYear: 0 }),
      1000,
      2026,
      3,
    )
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.recommendedDuesPerPayer === 0)).toBe(true)
    expect(rows[0].projectedPayers).toBe(0)
  })

  it('zeros bar-mitzvah payers when the org does not charge them', () => {
    const rows = projectDuesMultiYear(
      recInput({
        chargesBarMitzvahPayers: false,
        currentBarMitzvahPayers: 10,
        avgNewBarMitzvahsPerYear: 5,
      }),
      2000,
      2026,
      2,
    )
    expect(rows[0].projectedBarMitzvahPayers).toBe(0)
    expect(rows[1].projectedBarMitzvahPayers).toBe(0)
    expect(rows[1].projectedFamilies).toBe(52)
  })

  it('clamps fractional and out-of-range horizons', () => {
    expect(projectDuesMultiYear(recInput(), 100, 2026, 2.7)).toHaveLength(2)
    expect(projectDuesMultiYear(recInput(), 100, 2026, -5)).toHaveLength(1)
    expect(projectDuesMultiYear(recInput(), 100, 2026, 99)).toHaveLength(50)
  })
})

describe('DEFAULT_DUES_FORECAST_YEARS', () => {
  it('is 20', () => {
    expect(DEFAULT_DUES_FORECAST_YEARS).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// loadDuesRecommendation (mocked DB)
// ---------------------------------------------------------------------------

describe('loadDuesRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaderMocks.lifecycleEvents = [{ _id: 'ev-wed', type: 'wedding', name: 'Wedding', amount: 200 }]
    loaderMocks.familyCount = 40
    loaderMocks.bmCount = 3
    loaderMocks.newFamiliesAgg = [{ count: 10 }, { count: 5 }]
    loaderMocks.newBmAgg = [{ count: 4 }]
    loaderMocks.historySnaps = [
      { year: 2023, byPlan: [], byEvent: [] },
      {
        year: 2024,
        byEvent: [{ type: 'wedding', count: 4 }],
      },
      {
        year: 2025,
        byEvent: [{ type: 'wedding', count: 2 }],
      },
    ]
    loaderMocks.orgLean.mockResolvedValue({
      timezone: 'America/New_York',
      barMitzvahAutoAssignPlanId: 'plan-bm',
    })
  })

  it('aggregates DB inputs and excludes stale history snapshots', async () => {
    const out = await loadDuesRecommendation('507f1f77bcf86cd799439011', 5, 3, 2030)
    expect(loaderMocks.connectDB).toHaveBeenCalled()
    // Only 2 non-stale years; wedding counts 4+2 → avg 3 per window year
    expect(out.historyYearsSeen).toBe(2)
    expect(out.perEvent[0].historicalAvgCount).toBe(3)
    expect(out.perEvent[0].historicalSampleSize).toBe(2)
    expect(out.expectedAnnualEventExpense).toBe(600)
    expect(out.avgNewFamiliesPerYear).toBe(3)
    expect(out.avgNewBarMitzvahsPerYear).toBeCloseTo(0.8, 6)
    expect(out.chargesBarMitzvahPayers).toBe(true)
    expect(out.currentFamilies).toBe(40)
    expect(out.currentBarMitzvahPayers).toBe(3)
    expect(out.multiYear).toHaveLength(3)
    expect(out.multiYear[0].year).toBe(2030)
  })

  it('does not count bar-mitzvah payers when org has no auto-assign plan', async () => {
    loaderMocks.orgLean.mockResolvedValue({
      timezone: 'UTC',
      barMitzvahAutoAssignPlanId: null,
    })
    const out = await loadDuesRecommendation('507f1f77bcf86cd799439011')
    expect(out.chargesBarMitzvahPayers).toBe(false)
    expect(out.projectedNewPayersPerYear).toBe(out.avgNewFamiliesPerYear)
  })

  it('clamps windowYears to [1, 10]', async () => {
    const narrow = await loadDuesRecommendation('507f1f77bcf86cd799439011', 0)
    expect(narrow.historyWindowYears).toBe(1)
    const wide = await loadDuesRecommendation('507f1f77bcf86cd799439011', 99)
    expect(wide.historyWindowYears).toBe(10)
  })

  it('treats missing aggregate counts as zero', async () => {
    loaderMocks.newFamiliesAgg = [{ count: undefined as unknown as number }]
    loaderMocks.newBmAgg = []
    loaderMocks.historySnaps = []
    const out = await loadDuesRecommendation('507f1f77bcf86cd799439011', 5)
    expect(out.avgNewFamiliesPerYear).toBe(0)
    expect(out.avgNewBarMitzvahsPerYear).toBe(0)
    expect(out.perEvent[0].historicalAvgCount).toBe(0)
  })
})
