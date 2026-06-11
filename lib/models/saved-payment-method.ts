import mongoose, { Schema } from 'mongoose'

const SavedPaymentMethodSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  stripePaymentMethodId: { type: String, required: true }, // Stripe payment method ID
  last4: { type: String, required: true }, // Last 4 digits
  cardType: { type: String, required: true }, // Visa, Mastercard, etc.
  expiryMonth: { type: Number, required: true },
  expiryYear: { type: Number, required: true },
  nameOnCard: String,
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
// Family payment-methods list filters by `{ organizationId, familyId,
// isActive }`. Without this index every charge-saved-card call did a
// per-org scan.
SavedPaymentMethodSchema.index({ organizationId: 1, familyId: 1, isActive: 1 })
// Stripe payment-method IDs should be unique per org *among active
// rows* so a retry doesn't create a second row pointing at the same
// Stripe PM. Scoped to `isActive: true` because legitimate deletes
// (cycle a stale card out, then save it again) could otherwise collide.
SavedPaymentMethodSchema.index(
  { organizationId: 1, stripePaymentMethodId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
)

export const SavedPaymentMethod = mongoose.models.SavedPaymentMethod || mongoose.model('SavedPaymentMethod', SavedPaymentMethodSchema)
