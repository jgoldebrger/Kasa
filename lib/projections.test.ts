import { beforeEach, describe, expect, it, vi } from 'vitest'

const loaderMocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  orgLean: vi.fn(
    async () =>
      ({
        timezone: 'UTC',
        barMitzvahAutoAssignPlanId: null,
        barMitzvahAutoCreateEventTypeId: null,
        addChildAutoCreateEventTypeId: null,
      }) as Record<string, unknown>,
  ),
  lifecycleEvents: [] as Array<{ _id: string; type: string; name: string; amount: number }>,
  familyCount: 50,
  bmCount: 0,
  newFamiliesAgg: [] as Array<{ count: number }>,
  newBmAgg: [] as Array<{ count: number }>,
  newChildrenAgg: [] as Array<{ count: number }>,
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
  yearlySnapshots: [] as Array<{ calculatedIncome?: number; calculatedExpenses?: number }>,
  lifecycleCountsByYear: {} as Record<number, Array<{ type: string; count: number }>>,
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
  countLifecycleEvents: vi.fn(async (year: number) => {
    const rows = loaderMocks.lifecycleCountsByYear[year] ?? []
    return rows.map((r) => ({
      type: r.type,
      name: r.type,
      configuredAmount: 0,
      count: r.count,
      amount: 0,
    }))
  }),
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
      if (str.includes('createdAt')) return loaderMocks.newChildrenAgg
      return loaderMocks.newBmAgg
    }),
  },
  LifecycleEvent: {},
  YearlyCalculation: {
    find: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: vi.fn(async () => loaderMocks.yearlySnapshots),
      })),
    })),
  },
  Payment: { aggregate: vi.fn(async () => [{ total: 0 }]) },
  LifecycleEventPayment: { aggregate: vi.fn(async () => [{ total: 0 }]) },
}))

import {
  blendEventProjections,
  computeDuesRecommendation,
  computeSolvencyScaleFactor,
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
    avgNewChildrenPerYear: 3,
    chargesBarMitzvahPayers: false,
    growthLookbackYears: 5,
    openingFundBalance: 10_000,
    solvencyScaleFactor: 1,
    historyYearsWithData: 5,
    plans: [
      { planId: 'p1', planName: 'Standard', currentPrice: 1000, familyCount: 30 },
      { planId: 'p2', planName: 'Young', currentPrice: 500, familyCount: 20 },
    ],
    currentPlanIncome: 40_000,
    expensesByYear: [10_000, 10_000, 10_000],
    eventTypes: [
      {
        eventTypeId: 'bar',
        type: 'barmitzvah',
        name: 'Bar Mitzvah',
        currentCost: 500,
        rosterSource: 'bar_mitzvah',
        historicalAvgPerYear: 2,
        blendedCountByYear: [2, 2, 2],
        rosterCountStartYear: 0,
      },
      {
        eventTypeId: 'wed',
        type: 'wedding',
        name: 'Wedding',
        currentCost: 300,
        rosterSource: 'member_wedding',
        historicalAvgPerYear: 4,
        blendedCountByYear: [4, 4, 4],
        rosterCountStartYear: 1,
      },
    ],
    ...over,
  }
}

describe('blendEventProjections', () => {
  it('uses historical average when roster has no dates', () => {
    const types = [
      {
        eventTypeId: 'wed',
        type: 'wedding',
        name: 'Wedding',
        currentCost: 300,
        rosterSource: 'member_wedding' as const,
      },
    ]
    const { expensesByYear } = blendEventProjections(
      types,
      new Map([['wed', [0, 0, 0]]]),
      new Map([['wed', 4]]),
      null,
      0,
      3,
    )
    expect(expensesByYear[0]).toBe(1200)
    expect(expensesByYear[2]).toBe(1200)
  })

  it('uses the higher of roster count and historical average', () => {
    const types = [
      {
        eventTypeId: 'bar',
        type: 'barmitzvah',
        name: 'Bar Mitzvah',
        currentCost: 500,
        rosterSource: 'bar_mitzvah' as const,
      },
    ]
    const { expensesByYear } = blendEventProjections(
      types,
      new Map([['bar', [1, 0, 3]]]),
      new Map([['bar', 2]]),
      null,
      0,
      3,
    )
    expect(expensesByYear[0]).toBe(1000)
    expect(expensesByYear[1]).toBe(1000)
    expect(expensesByYear[2]).toBe(1500)
  })
})

describe('computeSolvencyScaleFactor', () => {
  it('returns 1 when the fund stays solvent at current income', () => {
    expect(computeSolvencyScaleFactor(10_000, [40_000, 40_000], [10_000, 10_000])).toBe(1)
  })

  it('returns a scale > 1 when expenses outpace income and opening balance', () => {
    const scale = computeSolvencyScaleFactor(0, [40_000, 40_000], [50_000, 50_000])
    expect(scale).toBeGreaterThan(1)
    expect(scale).toBeCloseTo(1.25, 2)
  })
})

describe('projectDuesMultiYear — fund balance', () => {
  it('tracks opening and closing fund balance at current plan prices', () => {
    const rows = projectDuesMultiYear(recInput(), 2026, 2)
    expect(rows[0].openingFundBalance).toBe(10_000)
    expect(rows[0].closingFundBalance).toBe(10_000 + 40_000 - 10_000)
    expect(rows[1].openingFundBalance).toBe(rows[0].closingFundBalance)
    expect(rows[0].fundSolvent).toBe(true)
  })

  it('flags insolvent years when the fund runs dry', () => {
    const rows = projectDuesMultiYear(
      recInput({ openingFundBalance: 0, expensesByYear: [50_000, 50_000] }),
      2026,
      2,
    )
    expect(rows[0].fundSolvent).toBe(false)
  })
})

describe('computeDuesRecommendation', () => {
  it('applies solvency scale when higher than the annual expense ratio', () => {
    const out = computeDuesRecommendation(
      recInput({ solvencyScaleFactor: 1.5, expensesByYear: [10_000] }),
      { startYear: 2026, forecastYears: 1 },
    )
    expect(out.multiYear[0].scaleFactor).toBe(1.5)
    expect(out.solvencyScaleFactor).toBe(1.5)
    expect(out.expenseSource).toBe('blended')
  })
})

describe('loadDuesRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaderMocks.lifecycleEvents = [
      { _id: 'ev-bar', type: 'barmitzvah', name: 'Bar Mitzvah', amount: 500 },
      { _id: 'ev-wed', type: 'wedding', name: 'Wedding', amount: 300 },
    ]
    loaderMocks.familyCount = 40
    loaderMocks.newChildrenAgg = [{ count: 15 }]
    loaderMocks.rosterAgg = { bar: [{ _id: '2030', count: 2 }], bat: [], wedding: [] }
    loaderMocks.planBreakdown = [
      { planId: 'p1', name: 'Standard', yearlyPrice: 1000, familyCount: 40, income: 40_000 },
    ]
    loaderMocks.yearlySnapshots = [{ calculatedIncome: 50_000, calculatedExpenses: 30_000 }]
    loaderMocks.lifecycleCountsByYear = {
      2024: [{ type: 'wedding', count: 4 }],
      2025: [{ type: 'wedding', count: 2 }],
    }
    loaderMocks.orgLean.mockResolvedValue({
      timezone: 'UTC',
      barMitzvahAutoAssignPlanId: null,
      barMitzvahAutoCreateEventTypeId: 'ev-bar',
      addChildAutoCreateEventTypeId: null,
    })
  })

  it('blends roster, history, and opening fund balance', async () => {
    const out = await loadDuesRecommendation('507f1f77bcf86cd799439011', 5, 3, 2030)
    expect(out.openingFundBalance).toBe(20_000)
    expect(out.avgNewChildrenPerYear).toBe(3)
    expect(out.expenseSource).toBe('blended')
    expect(out.multiYear[0].projectedExpenses).toBeGreaterThan(0)
    expect(out.multiYear[0].closingFundBalance).toBeDefined()
  })
})

describe('DEFAULT_DUES_FORECAST_YEARS', () => {
  it('is 20', () => {
    expect(DEFAULT_DUES_FORECAST_YEARS).toBe(20)
  })
})
