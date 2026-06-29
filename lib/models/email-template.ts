import mongoose, { Schema } from 'mongoose'

const EmailTemplateSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: {
      type: String,
      enum: ['general', 'billing', 'events', 'announcements'],
      default: 'general',
    },
    subject: { type: String, required: true, maxlength: 998 },
    html: { type: String, required: true, maxlength: 100_000 },
    text: { type: String, maxlength: 100_000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    previousVersionId: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion' },
    versionNote: { type: String, maxlength: 500, trim: true },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

EmailTemplateSchema.index({ organizationId: 1, name: 1 })

export const EmailTemplate =
  mongoose.models.EmailTemplate || mongoose.model('EmailTemplate', EmailTemplateSchema)
