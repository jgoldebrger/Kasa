import { beforeEach, describe, expect, it, vi } from 'vitest'

const loaderMocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  orgLean: vi.fn(
    async () =>
      ({
        timezone: 'UTC',
        barMitzvahAutoAssignPlanId: null,
        barMitzvahAutoCreateEventTypeId: null,
      }) as Record<string, unknown>,
  ),
  lifecycleEvents: [] as Array<{ _id: string; type: string; name: string; amount: number }>,
  familyCount: 50,
  bmCount: 0,
  newFamiliesAgg: [] as Array<{ count: number }>,
  newBmAgg: [] as Array<{ count: number }>,
  rosterAgg: {
    bar: [] as Array<{ _id: string; count: number }>,
    bat: [] as Array<{ _id: string; count: number }>,
    wedding: [] as Array<{ _id: string; count: number }>,
  },
  planBreakdown: [] as Array<{
    planId: string
    name: string
    yearlyPrice: number
    familyCount: number
    income: number
  }>,
}))

vi.mock('./database', () => ({ default: loaderMocks.connectDB }))
vi.mock('./org-pagination', () => ({
  loadAllByIdCursor: vi.fn(async () => loaderMocks.lifecycleEvents),
}))
vi.mock('./calculations', () => ({
  countMembersByPaymentPlan: vi.fn(async () =>
    loaderMocks.planBreakdown.map((p) => ({
      planId: p.planId,
      planNumber: 1,
      name: p.name,
      yearlyPrice: p.yearlyPrice,
      count: 0,
      familyCount: p.familyCount,
      income: p.income,
    })),
  ),
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
    aggregate: vi.fn(async (pipeline: unknown[]) => {
      const str = JSON.stringify(pipeline)
      if (str.includes('barMitzvahDate')) return loaderMocks.rosterAgg.bar
      if (str.includes('batMitzvahDate')) return loaderMocks.rosterAgg.bat
      if (str.includes('weddingDate')) return loaderMocks.rosterAgg.wedding
      return loaderMocks.newBmAgg
    }),
  },
  LifecycleEvent: {},
}))

import {
  computeDuesRecommendation,
  DEFAULT_DUES_FORECAST_YEARS,
  loadDuesRecommendation,
  mapEventTypesToRoster,
  projectDuesMultiYear,
  projectRosterEventsByYear,
  type DuesRecommendationInput,
} from './projections'

function recInput(over: Partial<DuesRecommendationInput> = {}): DuesRecommendationInput {
  return {
    currentFamilies: 50,
    currentBarMitzvahPayers: 0,
    avgNewFamiliesPerYear: 2,
    avgNewBarMitzvahsPerYear: 0,
    chargesBarMitzvahPayers: false,
    growthLookbackYears: 5,
    plans: [
      { planId: 'p1', planName: 'Standard', currentPrice: 1000, familyCount: 30 },
      { planId: 'p2', planName: 'Young', currentPrice: 500, familyCount: 20 },
    ],
    currentPlanIncome: 40_000,
    expensesByYear: [2250, 0, 0, 0, 0],
    eventTypes: [
      {
        eventTypeId: 'bar',
        type: 'barmitzvah',
        name: 'Bar Mitzvah',
        currentCost: 500,
        rosterSource: 'bar_mitzvah',
        projectedCountByYear: [2, 0, 0, 0, 0],
      },
      {
        eventTypeId: 'wed',
        type: 'wedding',
        name: 'Wedding',
        currentCost: 300,
        rosterSource: 'member_wedding',
        projectedCountByYear: [1, 0, 0, 0, 0],
      },
    ],
    ...over,
  }
}

describe('mapEventTypesToRoster', () => {
  it('prefers explicit bar mitzvah automation id', () => {
    const types = [
      { eventTypeId: 'a', type: 'barmitzvah' },
      { eventTypeId: 'b', type: 'other' },
    ]
    const map = mapEventTypesToRoster(types, 'b')
    expect(map.get('b')).toBe('bar_mitzvah')
    expect(map.get('a')).toBeNull()
  })

  it('assigns each roster source at most once via heuristics', () => {
    const types = [
      { eventTypeId: 'bar', type: 'bar_mitzvah' },
      { eventTypeId: 'bat', type: 'bat_mitzvah' },
      { eventTypeId: 'wed', type: 'chasuna' },
      { eventTypeId: 'misc', type: 'bris' },
    ]
    const map = mapEventTypesToRoster(types, null)
    expect(map.get('bar')).toBe('bar_mitzvah')
    expect(map.get('bat')).toBe('bat_mitzvah')
    expect(map.get('wed')).toBe('member_wedding')
    expect(map.get('misc')).toBeNull()
  })
})

describe('projectRosterEventsByYear', () => {
  it('buckets bar mitzvah dates into the matching forecast year only', () => {
    const { expensesByYear, eventTypesWithCounts } = projectRosterEventsByYear(
      [
        {
          eventTypeId: 'bar',
          type: 'barmitzvah',
          name: 'Bar Mitzvah',
          currentCost: 500,
          rosterSource: 'bar_mitzvah',
        },
      ],
      {
        barMitzvah: new Map([[2028, 2]]),
        batMitzvah: new Map(),
        memberWedding: new Map(),
      },
      2026,
      5,
    )
    expect(expensesByYear[0]).toBe(0)
    expect(expensesByYear[2]).toBe(1000)
    expect(eventTypesWithCounts[0].projectedCountByYear[2]).toBe(2)
  })
})

describe('computeDuesRecommendation — proportional plan scaling', () => {
  it('scales all plan prices by the same factor to cover expenses', () => {
    const out = computeDuesRecommendation(recInput(), { startYear: 2026, forecastYears: 1 })
    // expenses 2250, income 40000 → factor 0.05625
    expect(out.multiYear[0].projectedExpenses).toBe(2250)
    expect(out.multiYear[0].projectedPlanIncome).toBe(40_000)
    expect(out.multiYear[0].scaleFactor).toBeCloseTo(2250 / 40_000, 6)
    expect(out.multiYear[0].planRecommendations[0].recommendedPrice).toBeCloseTo(56.25, 2)
    expect(out.multiYear[0].planRecommendations[1].recommendedPrice).toBeCloseTo(28.125, 2)
  })

  it('preserves plan price ratios after scaling', () => {
    const out = computeDuesRecommendation(recInput(), { startYear: 2026, forecastYears: 1 })
    const [a, b] = out.multiYear[0].planRecommendations
    expect(a.recommendedPrice / b.recommendedPrice).toBeCloseTo(2, 6)
  })

  it('returns scale factor 0 when plan income is zero', () => {
    const out = computeDuesRecommendation(recInput({ currentPlanIncome: 0, plans: [] }), {
      startYear: 2026,
      forecastYears: 1,
    })
    expect(out.multiYear[0].scaleFactor).toBe(0)
    expect(out.multiYear[0].planRecommendations).toHaveLength(0)
  })

  it('grows projected plan income with family count', () => {
    const out = computeDuesRecommendation(recInput(), { startYear: 2026, forecastYears: 3 })
    expect(out.multiYear[2].projectedFamilies).toBe(54)
    expect(out.multiYear[2].projectedPlanIncome).toBeCloseTo(40_000 * (54 / 50), 6)
  })

  it('exposes per-event start-year counts from roster', () => {
    const out = computeDuesRecommendation(recInput())
    expect(out.perEvent[0].projectedCountStartYear).toBe(2)
    expect(out.perEvent[0].projectedExpenseStartYear).toBe(1000)
    expect(out.perEvent[1].projectedCountStartYear).toBe(1)
    expect(out.expenseSource).toBe('roster')
  })

  it('counts bar-mitzvah payers when the org opts in', () => {
    const out = computeDuesRecommendation(
      recInput({
        chargesBarMitzvahPayers: true,
        currentBarMitzvahPayers: 5,
        avgNewBarMitzvahsPerYear: 3,
      }),
    )
    expect(out.currentPayers).toBe(55)
    expect(out.projectedPayers).toBe(60)
  })
})

describe('projectDuesMultiYear', () => {
  it('clamps fractional and out-of-range horizons', () => {
    expect(projectDuesMultiYear(recInput(), 2026, 2.7)).toHaveLength(2)
    expect(projectDuesMultiYear(recInput(), 2026, -5)).toHaveLength(1)
    expect(projectDuesMultiYear(recInput(), 2026, 99)).toHaveLength(50)
  })
})

describe('DEFAULT_DUES_FORECAST_YEARS', () => {
  it('is 20', () => {
    expect(DEFAULT_DUES_FORECAST_YEARS).toBe(20)
  })
})

describe('loadDuesRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaderMocks.lifecycleEvents = [
      { _id: 'ev-bar', type: 'barmitzvah', name: 'Bar Mitzvah', amount: 500 },
    ]
    loaderMocks.familyCount = 40
    loaderMocks.bmCount = 3
    loaderMocks.newFamiliesAgg = [{ count: 10 }, { count: 5 }]
    loaderMocks.newBmAgg = [{ count: 4 }]
    loaderMocks.rosterAgg = {
      bar: [{ _id: '2030', count: 2 }],
      bat: [],
      wedding: [],
    }
    loaderMocks.planBreakdown = [
      { planId: 'p1', name: 'Standard', yearlyPrice: 1000, familyCount: 40, income: 40_000 },
    ]
    loaderMocks.orgLean.mockResolvedValue({
      timezone: 'America/New_York',
      barMitzvahAutoAssignPlanId: 'plan-bm',
      barMitzvahAutoCreateEventTypeId: 'ev-bar',
    })
  })

  it('uses roster dates and plans without YearlyCalculation', async () => {
    const out = await loadDuesRecommendation('507f1f77bcf86cd799439011', 5, 3, 2030)
    expect(loaderMocks.connectDB).toHaveBeenCalled()
    expect(out.expenseSource).toBe('roster')
    expect(out.currentPlanIncome).toBe(40_000)
    expect(out.plans).toHaveLength(1)
    expect(out.multiYear[0].year).toBe(2030)
    expect(out.multiYear[0].projectedExpenses).toBe(1000)
    expect(out.perEvent[0].rosterMapped).toBe(true)
    expect(out.avgNewFamiliesPerYear).toBe(3)
    expect(out.chargesBarMitzvahPayers).toBe(true)
  })

  it('returns zero expenses when roster has no dates in range', async () => {
    loaderMocks.rosterAgg = { bar: [], bat: [], wedding: [] }
    const out = await loadDuesRecommendation('507f1f77bcf86cd799439011', 5, 1, 2030)
    expect(out.multiYear[0].projectedExpenses).toBe(0)
    expect(out.multiYear[0].scaleFactor).toBe(0)
  })

  it('clamps growth lookback to [1, 10]', async () => {
    const narrow = await loadDuesRecommendation('507f1f77bcf86cd799439011', 0)
    expect(narrow.growthLookbackYears).toBe(1)
    const wide = await loadDuesRecommendation('507f1f77bcf86cd799439011', 99)
    expect(wide.growthLookbackYears).toBe(10)
  })
})
