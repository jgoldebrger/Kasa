import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const LifecycleEventSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  type: { type: String, required: true, lowercase: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
}, { timestamps: true })
// Partial unique so deleted event types don't block re-creating one with the same `type`.
LifecycleEventSchema.index(
  { organizationId: 1, type: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
LifecycleEventSchema.plugin(softDeletePlugin)

export const LifecycleEvent = mongoose.models.LifecycleEvent || mongoose.model('LifecycleEvent', LifecycleEventSchema)
