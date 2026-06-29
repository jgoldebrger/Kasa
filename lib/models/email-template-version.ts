import mongoose, { Schema } from 'mongoose'

const EmailTemplateVersionSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      required: true,
      index: true,
    },
    version: { type: Number, required: true },
    subject: { type: String, required: true, maxlength: 998 },
    html: { type: String, required: true, maxlength: 100_000 },
    text: { type: String, maxlength: 100_000 },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

EmailTemplateVersionSchema.index({ templateId: 1, version: -1 })

export const EmailTemplateVersion =
  mongoose.models.EmailTemplateVersion ||
  mongoose.model('EmailTemplateVersion', EmailTemplateVersionSchema)
