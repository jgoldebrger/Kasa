import mongoose, { Schema } from 'mongoose'

/** Admin-scheduled email delivery of a saved report pivot view. */
const ScheduledReportSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    savedReportId: {
      type: Schema.Types.ObjectId,
      ref: 'SavedReport',
      required: true,
      index: true,
    },
    frequency: {
      type: String,
      enum: ['weekly', 'monthly'],
      required: true,
    },
    /** Recipient address; defaults to org EmailConfig address when omitted at send time. */
    recipientEmail: { type: String, trim: true },
    enabled: { type: Boolean, default: true },
    lastRunAt: Date,
    nextRunAt: { type: Date, required: true, index: true },
    lastError: { type: String, maxlength: 2000 },
  },
  { timestamps: true },
)

ScheduledReportSchema.index({ organizationId: 1, savedReportId: 1 }, { unique: true })

export const ScheduledReport =
  mongoose.models.ScheduledReport || mongoose.model('ScheduledReport', ScheduledReportSchema)
