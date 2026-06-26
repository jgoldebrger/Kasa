import { Types } from 'mongoose'
import { Family, PaymentPlan, LifecycleEventPayment, CycleConfig, Organization } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { MERGE_FIELD_DEFINITIONS, type MergeFieldKey } from './merge-field-definitions'

export type MergeFieldContext = Partial<Record<MergeFieldKey, string | number>>

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

function formatFullAddress(family: {
  street?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}): string {
  const line1 = (family.street || family.address || '').trim()
  const cityState = [family.city?.trim(), family.state?.trim()].filter(Boolean).join(', ')
  const line2 = [cityState, family.zip?.trim()]
    .filter(Boolean)
    .join(cityState && family.zip ? ' ' : '')
  return [line1, line2].filter(Boolean).join(', ')
}

function formatMergeValue(key: MergeFieldKey, raw: string | number): string {
  if (key === 'balance' || key === 'dues') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    return formatMoney(Number.isFinite(n) ? n : 0)
  }
  return String(raw)
}

/** Replace merge tokens in a template string. */
export function applyMergeFields(template: string, ctx: MergeFieldContext): string {
  let out = template
  for (const def of MERGE_FIELD_DEFINITIONS) {
    const raw = ctx[def.key]
    if (raw == null || raw === '') continue
    const formatted = formatMergeValue(def.key, raw)
    out = out.replace(new RegExp(`\\{\\{${def.key}\\}\\}`, 'g'), formatted)
  }
  return out
}

/** Load merge-field context for a family from the database. */
export async function loadMergeFieldContext(
  familyId: string,
  organizationId: string,
): Promise<MergeFieldContext> {
  const orgId = new Types.ObjectId(organizationId)

  const [family, org, cycleConfig] = await Promise.all([
    Family.findOne({ _id: familyId, organizationId: orgId })
      .select(
        'name hebrewName email phone husbandCellPhone wifeCellPhone street address city state zip paymentPlanId',
      )
      .lean<{
        name?: string
        hebrewName?: string
        email?: string
        phone?: string
        husbandCellPhone?: string
        wifeCellPhone?: string
        street?: string
        address?: string
        city?: string
        state?: string
        zip?: string
        paymentPlanId?: Types.ObjectId
      }>(),
    Organization.findById(orgId).select('name').lean<{ name?: string }>(),
    CycleConfig.findOne({ organizationId: orgId, isActive: true })
      .select('cycleStartMonth cycleStartDay')
      .lean<{ cycleStartMonth?: number; cycleStartDay?: number }>(),
  ])

  if (!family) {
    return { familyName: '', orgName: org?.name || '' }
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
      organizationId: orgId,
    })
      .select('name')
      .lean<{ name?: string }>()
    planName = plan?.name || ''
  }

  const now = new Date()
  const upcoming = await LifecycleEventPayment.findOne({
    organizationId: orgId,
    familyId,
    eventDate: { $gte: now },
    deletedAt: null,
  })
    .sort({ eventDate: 1 })
    .select('eventDate')
    .lean<{ eventDate?: Date }>()

  const nextDueDate = computeNextCycleDueDate(cycleConfig, now)
  const fullAddress = formatFullAddress(family)

  return {
    familyName: family.name || '',
    hebrewName: family.hebrewName || '',
    email: family.email || '',
    phone: family.phone || '',
    husbandCellPhone: family.husbandCellPhone || '',
    wifeCellPhone: family.wifeCellPhone || '',
    street: family.street || family.address || '',
    city: family.city || '',
    state: family.state || '',
    zip: family.zip || '',
    fullAddress,
    balance,
    dues,
    planName,
    eventDate: upcoming?.eventDate ? formatDate(new Date(upcoming.eventDate)) : '',
    nextDue: nextDueDate ? formatDate(nextDueDate) : '',
    orgName: org?.name || '',
  }
}

export {
  MERGE_FIELD_DEFINITIONS,
  mergeFieldToken,
  mergeFieldSamples,
} from './merge-field-definitions'
