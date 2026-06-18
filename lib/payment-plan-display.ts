/** Normalize payment plan / family plan ids for reliable string comparison. */
export function normalizePlanId(id: unknown): string {
  if (id == null || id === '') return ''
  if (typeof id === 'object') {
    const obj = id as { _id?: unknown; toString?: () => string }
    if (obj._id != null) return String(obj._id)
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const s = obj.toString()
      if (s && s !== '[object Object]') return s
    }
  }
  return String(id)
}

export function findPlanById<T extends { _id?: unknown }>(
  plans: T[],
  planId: unknown,
): T | undefined {
  const needle = normalizePlanId(planId)
  if (!needle) return undefined
  return plans.find((p) => normalizePlanId(p._id) === needle)
}

export function getPlanDisplayName(
  plans: Array<{ _id?: unknown; name: string; planNumber?: number }>,
  planId: unknown,
  currentPlan?: number | null,
  labels?: { noPlan?: string; unknown?: string },
): string {
  const noPlan = labels?.noPlan ?? 'No Plan'
  const unknown = labels?.unknown ?? 'Unknown Plan'
  const plan = findPlanById(plans, planId)
  if (plan) return plan.name
  if (currentPlan != null && currentPlan > 0 && plans.length > 0) {
    const legacy = plans.find((p) => p.planNumber === currentPlan)
    if (legacy) return legacy.name
  }
  if (!normalizePlanId(planId)) return noPlan
  return unknown
}
