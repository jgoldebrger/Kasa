import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const LifecycleEventPaymentSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember' },
  eventType: { type: String, required: true, lowercase: true },
  eventDate: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0 },
  notes: String,
  year: Number, // Year for calculation purposes
}, { timestamps: true })
LifecycleEventPaymentSchema.index({ organizationId: 1, year: 1 })
// Family detail page lists lifecycle events per family ordered by
// `eventDate desc`. Without this compound index those queries either
// scanned all org events or paid a per-doc sort.
LifecycleEventPaymentSchema.index({ organizationId: 1, familyId: 1, eventDate: -1 })
LifecycleEventPaymentSchema.plugin(softDeletePlugin)

export const LifecycleEventPayment = mongoose.models.LifecycleEventPayment || mongoose.model('LifecycleEventPayment', LifecycleEventPaymentSchema)
