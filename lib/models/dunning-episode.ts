import mongoose, { Schema } from 'mongoose'

const DunningEpisodeSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'EmailAutomationRule', required: true },
    status: { type: String, enum: ['open', 'closed'], required: true, default: 'open' },
    sendCount: { type: Number, default: 0, min: 0 },
    lastSentAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedReason: {
      type: String,
      enum: ['payment', 'max_attempts', 'no_longer_qualifies', null],
      default: null,
    },
  },
  { timestamps: true },
)

DunningEpisodeSchema.index(
  { organizationId: 1, familyId: 1, ruleId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)
DunningEpisodeSchema.index({ organizationId: 1, familyId: 1, status: 1 })
DunningEpisodeSchema.index({ organizationId: 1, ruleId: 1, status: 1 })

export const DunningEpisode =
  mongoose.models.DunningEpisode || mongoose.model('DunningEpisode', DunningEpisodeSchema)
