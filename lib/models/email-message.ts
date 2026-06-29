import mongoose, { Schema } from 'mongoose'

const EmailMessageEventSchema = new Schema(
  {
    type: { type: String, required: true },
    at: { type: Date, required: true, default: Date.now },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false },
)

const EmailMessageSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    emailJobId: { type: Schema.Types.ObjectId, ref: 'EmailJob' },
    campaignId: { type: Schema.Types.ObjectId, index: true },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    bodyPreview: { type: String, maxlength: 200 },
    html: { type: String, maxlength: 100_000 },
    text: { type: String, maxlength: 100_000 },
    kind: {
      type: String,
      enum: ['custom', 'statement', 'tax-receipt', 'task-reminder', 'file'],
      required: true,
      index: true,
    },
    provider: { type: String, enum: ['gmail'], default: 'gmail' },
    status: {
      type: String,
      enum: ['queued', 'sent', 'opened', 'clicked', 'failed', 'bounced'],
      default: 'queued',
      index: true,
    },
    events: { type: [EmailMessageEventSchema], default: [] },
    relatedResource: {
      type: { type: String },
      id: { type: String },
    },
    error: String,
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    firstOpenedAt: Date,
    firstClickedAt: Date,
    openTracking: { type: Boolean, default: false },
    clickTracking: { type: Boolean, default: false },
    subjectVariant: { type: String, enum: ['A', 'B'] },
  },
  { timestamps: true },
)

EmailMessageSchema.index({ organizationId: 1, createdAt: -1 })
EmailMessageSchema.index({ organizationId: 1, familyId: 1, createdAt: -1 })
EmailMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 730, name: 'email_message_ttl' },
)

export const EmailMessage =
  mongoose.models.EmailMessage || mongoose.model('EmailMessage', EmailMessageSchema)
