export interface YoYMetric {
  label: string
  current: number
  prior: number
  delta: number
  deltaPct: number | null
}

export function yoyDelta(
  current: number,
  prior: number,
): { delta: number; deltaPct: number | null } {
  const delta = current - prior
  if (!Number.isFinite(prior) || prior === 0) {
    return { delta, deltaPct: null }
  }
  return { delta, deltaPct: (delta / Math.abs(prior)) * 100 }
}

export function buildYoYMetrics(
  current: { income: number; expenses: number; balance: number },
  prior: { income: number; expenses: number; balance: number },
  labels: { income: string; expenses: string; balance: string },
): YoYMetric[] {
  const rows: Array<[string, number, number]> = [
    [labels.income, current.income, prior.income],
    [labels.expenses, current.expenses, prior.expenses],
    [labels.balance, current.balance, prior.balance],
  ]
  return rows.map(([label, cur, prv]) => {
    const { delta, deltaPct } = yoyDelta(cur, prv)
    return { label, current: cur, prior: prv, delta, deltaPct }
  })
}
