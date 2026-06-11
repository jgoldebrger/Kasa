import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const WithdrawalSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  amount: { type: Number, required: true, min: 0 },
  withdrawalDate: { type: Date, required: true },
  reason: String,
  notes: String,
}, { timestamps: true })
// Compound index that backs every family-detail / statement period /
// balance lookup. Without this Mongoose falls back to an org-only scan
// + in-memory familyId filter for large tenants.
WithdrawalSchema.index({ organizationId: 1, familyId: 1, withdrawalDate: -1 })
// Withdrawals participate in soft-delete so the recycle-bin family
// cascade can hide them without losing the audit row.
WithdrawalSchema.plugin(softDeletePlugin)

export const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', WithdrawalSchema)
