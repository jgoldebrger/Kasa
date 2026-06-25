import mongoose, { Schema } from 'mongoose'

const ScheduledEmailSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    subject: { type: String, required: true, maxlength: 998 },
    html: { type: String, required: true, maxlength: 100_000 },
    text: { type: String, maxlength: 100_000 },
    familyIds: [{ type: Schema.Types.ObjectId, ref: 'Family', required: true }],
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'cancelled', 'failed'],
      default: 'pending',
      index: true,
    },
    sentAt: Date,
    error: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

ScheduledEmailSchema.index({ organizationId: 1, status: 1, scheduledFor: 1 })

export const ScheduledEmail =
  mongoose.models.ScheduledEmail || mongoose.model('ScheduledEmail', ScheduledEmailSchema)
