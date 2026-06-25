import mongoose, { Schema } from 'mongoose'

const EmailDraftSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    subject: { type: String, default: '', maxlength: 998 },
    body: { type: String, default: '', maxlength: 100_000 },
    html: { type: String, default: '', maxlength: 100_000 },
    selectedFamilyIds: [{ type: Schema.Types.ObjectId, ref: 'Family' }],
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
)

EmailDraftSchema.index({ organizationId: 1, userId: 1, updatedAt: -1 })

export const EmailDraft =
  mongoose.models.EmailDraft || mongoose.model('EmailDraft', EmailDraftSchema)
