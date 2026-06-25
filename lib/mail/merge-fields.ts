import { Types } from 'mongoose'
import { Family, PaymentPlan, LifecycleEventPayment, CycleConfig } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'

export interface MergeFieldContext {
  familyName?: string
  balance?: number
  dues?: number
  planName?: string
  eventDate?: string
  nextDue?: string
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function computeNextCycleDueDate(
  config: { cycleStartMonth?: number; cycleStartDay?: number } | null,
  ref = new Date(),
): Date | null {
  if (!config?.cycleStartMonth || !config?.cycleStartDay) return null
  const year = ref.getFullYear()
  const month = config.cycleStartMonth - 1
  const day = Math.min(config.cycleStartDay, new Date(year, month + 1, 0).getDate())
  const thisYear = new Date(year, month, day)
  if (thisYear >= ref) return thisYear
  const nextYear = year + 1
  const nextDay = Math.min(config.cycleStartDay, new Date(nextYear, month + 1, 0).getDate())
  return new Date(nextYear, month, nextDay)
}

/** Replace merge tokens in a template string. */
export function applyMergeFields(template: string, ctx: MergeFieldContext): string {
  let out = template
  if (ctx.familyName != null) {
    out = out.replace(/\{\{familyName\}\}/g, ctx.familyName)
  }
  if (ctx.balance != null) {
    out = out.replace(/\{\{balance\}\}/g, formatMoney(ctx.balance))
  }
  if (ctx.dues != null) {
    out = out.replace(/\{\{dues\}\}/g, formatMoney(ctx.dues))
  }
  if (ctx.planName != null) {
    out = out.replace(/\{\{planName\}\}/g, ctx.planName)
  }
  if (ctx.eventDate != null) {
    out = out.replace(/\{\{eventDate\}\}/g, ctx.eventDate)
  }
  if (ctx.nextDue != null) {
    out = out.replace(/\{\{nextDue\}\}/g, ctx.nextDue)
  }
  return out
}

/** Load merge-field context for a family from the database. */
export async function loadMergeFieldContext(
  familyId: string,
  organizationId: string,
): Promise<MergeFieldContext> {
  const family = await Family.findOne({ _id: familyId, organizationId })
    .select('name paymentPlanId')
    .lean<{ name?: string; paymentPlanId?: Types.ObjectId }>()
  if (!family) {
    return { familyName: '' }
  }

  let balance = 0
  let dues = 0
  try {
    const bal = await calculateFamilyBalance(familyId, organizationId)
    balance = bal.balance
    dues = bal.planCost
  } catch {
    /* use defaults */
  }

  let planName = ''
  if (family.paymentPlanId) {
    const plan = await PaymentPlan.findOne({
      _id: family.paymentPlanId,
      organizationId,
    })
      .select('name')
      .lean<{ name?: string }>()
    planName = plan?.name || ''
  }

  const now = new Date()
  const upcoming = await LifecycleEventPayment.findOne({
    organizationId,
    familyId,
    eventDate: { $gte: now },
    deletedAt: null,
  })
    .sort({ eventDate: 1 })
    .select('eventDate')
    .lean<{ eventDate?: Date }>()

  const cycleConfig = await CycleConfig.findOne({ organizationId, isActive: true })
    .select('cycleStartMonth cycleStartDay')
    .lean<{ cycleStartMonth?: number; cycleStartDay?: number }>()

  const nextDueDate = computeNextCycleDueDate(cycleConfig, now)

  return {
    familyName: family.name || '',
    balance,
    dues,
    planName,
    eventDate: upcoming?.eventDate ? formatDate(new Date(upcoming.eventDate)) : '',
    nextDue: nextDueDate ? formatDate(nextDueDate) : '',
  }
}
