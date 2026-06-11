import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const PaymentPlanSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true },
  planNumber: { type: Number, required: true },
  // Yearly plan prices are inherently non-negative. Mongoose `min: 0`
  // is a backstop in case a bad migration / script / future API path
  // bypasses Zod (which already rejects negatives).
  yearlyPrice: { type: Number, required: true, min: 0 },
  description: String,
}, { timestamps: true })
// Partial unique: only enforced for non-deleted plans so the planNumber
// can be reused once a soft-deleted plan is purged or restored elsewhere.
PaymentPlanSchema.index(
  { organizationId: 1, planNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
PaymentPlanSchema.plugin(softDeletePlugin)

export const PaymentPlan = mongoose.models.PaymentPlan || mongoose.model('PaymentPlan', PaymentPlanSchema)
