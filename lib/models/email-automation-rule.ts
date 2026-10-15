import mongoose, { Schema } from 'mongoose'

const EmailAutomationRuleSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    enabled: { type: Boolean, default: false },
    templateId: { type: Schema.Types.ObjectId, ref: 'EmailTemplate', required: true },
    ruleType: {
      type: String,
      enum: ['balance_gt_zero', 'event_within_30_days', 'dunning_arrears'],
      required: true,
    },
    minOwed: { type: Number, min: 0 },
    daysSinceObligation: { type: Number, min: 1, max: 3650 },
    maxAttempts: { type: Number, min: 1, max: 12 },
    intervalDays: { type: Number, min: 1, max: 90 },
    lastRunAt: { type: Date, default: null },
    lastRunSentCount: { type: Number, default: null },
    lastRunSkippedCount: { type: Number, default: null },
    lastRunFailedCount: { type: Number, default: null },
    lastRunError: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
)

EmailAutomationRuleSchema.index({ organizationId: 1, enabled: 1 })

export const EmailAutomationRule =
  mongoose.models.EmailAutomationRule ||
  mongoose.model('EmailAutomationRule', EmailAutomationRuleSchema)
