export interface ScenarioPlanRow {
  planId: string
  planName: string
  currentPrice: number
  recommendedPrice: number
}

export interface DuesScenarioResult {
  duesChangePct: number
  adjustedPlanIncome: number
  adjustedClosingBalance: number
  adjustedScaleFactor: number
  fundSolvent: boolean
  planRecommendations: ScenarioPlanRow[]
}

interface ScenarioInput {
  openingFundBalance: number
  projectedExpenses: number
  projectedPlanIncome: number
  scaleFactor: number
  plans: Array<{
    planId: string
    planName: string
    currentPrice: number
    recommendedPrice: number
  }>
}

/** Client-side what-if: shift all plan income by a percentage. */
export function applyDuesScenario(input: ScenarioInput, duesChangePct: number): DuesScenarioResult {
  const incomeMultiplier = 1 + duesChangePct / 100
  const adjustedPlanIncome = input.projectedPlanIncome * incomeMultiplier
  const adjustedClosingBalance =
    input.openingFundBalance + adjustedPlanIncome - input.projectedExpenses

  const baseScale = input.projectedPlanIncome > 0 ? input.scaleFactor : 1
  const scenarioScale =
    input.projectedPlanIncome > 0
      ? Math.max(1, input.projectedExpenses / adjustedPlanIncome)
      : baseScale

  const planRecommendations = input.plans.map((p) => ({
    planId: p.planId,
    planName: p.planName,
    currentPrice: p.currentPrice,
    recommendedPrice: p.currentPrice * scenarioScale,
  }))

  return {
    duesChangePct,
    adjustedPlanIncome,
    adjustedClosingBalance,
    adjustedScaleFactor: scenarioScale,
    fundSolvent: adjustedClosingBalance >= 0,
    planRecommendations,
  }
}

export function formatScenarioAdjustment(scaleFactor: number): string {
  if (!Number.isFinite(scaleFactor) || scaleFactor === 0) return '0%'
  const pct = (scaleFactor - 1) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}
