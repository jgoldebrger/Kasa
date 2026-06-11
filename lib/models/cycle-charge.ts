import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

// CycleCharge Schema
//
// One record per (family, cycleYear) representing the annual membership
// dues charge captured at cycle-rollover time. The cycle-rollover cron
// (/api/jobs/cycle-rollover) is the sole producer; admins can also see
// them in the family's transaction history.
//
// The unique partial index on (organizationId, familyId, cycleYear)
// makes the cron idempotent: re-running on the same day (or a manual
// re-trigger) does nothing rather than double-charging.
//
// `planId` and `planName` are snapshotted at the moment of rollover so
// historical charges stay accurate even if a family later switches
// plans or a plan is renamed/deleted.
//
// `cycleYear` is the year the cycle BEGINS, in whichever calendar the
// org used at rollover time (e.g. 2026 for Gregorian, 5786 for Hebrew).
// We keep the calendar context in `calendar` so the UI can render a
// human label without guessing.
const CycleChargeSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  cycleYear: { type: Number, required: true },
  calendar: { type: String, enum: ['gregorian', 'hebrew'], required: true },
  chargeDate: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0 },
  planId: { type: Schema.Types.ObjectId, ref: 'PaymentPlan' },
  planName: { type: String, default: '' },
  notes: { type: String, default: '' },
}, { timestamps: true })
CycleChargeSchema.index({ organizationId: 1, familyId: 1, chargeDate: -1 })
// Idempotency: the rollover cron tries to create the same row on each
// run; the unique index lets us safely `insertMany({ ordered: false })`
// and ignore the resulting E11000s without coordination.
CycleChargeSchema.index(
  { organizationId: 1, familyId: 1, cycleYear: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
CycleChargeSchema.plugin(softDeletePlugin)

export const CycleCharge = mongoose.models.CycleCharge || mongoose.model('CycleCharge', CycleChargeSchema)
