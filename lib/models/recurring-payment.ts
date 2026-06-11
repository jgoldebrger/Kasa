import mongoose, { Schema } from 'mongoose'

const RecurringPaymentSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  savedPaymentMethodId: { type: Schema.Types.ObjectId, ref: 'SavedPaymentMethod', required: true },
  amount: { type: Number, required: true, min: 0 },
  frequency: { type: String, enum: ['monthly'], default: 'monthly' },
  startDate: { type: Date, required: true },
  nextPaymentDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  notes: String,
}, { timestamps: true })
RecurringPaymentSchema.index({ organizationId: 1, isActive: 1, nextPaymentDate: 1 })

export const RecurringPayment = mongoose.models.RecurringPayment || mongoose.model('RecurringPayment', RecurringPaymentSchema)
