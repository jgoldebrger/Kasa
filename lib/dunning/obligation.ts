import { CycleCharge, CycleConfig, Organization } from '@/lib/models'
import { currentBillingCycleStart } from './cycle-start'

export async function obligationStartDate(args: {
  organizationId: string
  familyId: string
  familyCreatedAt: Date
  now?: Date
}): Promise<Date> {
  const earliest = await CycleCharge.find({
    organizationId: args.organizationId,
    familyId: args.familyId,
    deletedAt: null,
  })
    .sort({ chargeDate: 1 })
    .limit(1)
    .lean()

  const chargeDate = earliest[0]?.chargeDate
  if (chargeDate) return chargeDate

  const [config, org] = await Promise.all([
    CycleConfig.findOne({ organizationId: args.organizationId, isActive: true }).lean(),
    Organization.findById(args.organizationId).lean(),
  ])

  if (config) {
    return currentBillingCycleStart({
      calendar: config.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
      cycleStartMonth: config.cycleStartMonth ?? 1,
      cycleStartDay: config.cycleStartDay ?? 1,
      cycleStartHebrewMonth: config.cycleStartHebrewMonth ?? 7,
      cycleStartHebrewDay: config.cycleStartHebrewDay ?? 1,
      timezone: org?.timezone,
      now: args.now ?? new Date(),
    })
  }

  return args.familyCreatedAt
}
