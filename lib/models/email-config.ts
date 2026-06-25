import mongoose, { Schema } from 'mongoose'

const EmailConfigSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
      unique: true,
    },
    email: { type: String, required: true },
    password: { type: String, required: true }, // Encrypted at rest in Phase 4 via lib/encryption.ts
    fromName: { type: String, default: 'Kasa Family Management' },
    replyTo: { type: String },
    isActive: { type: Boolean, default: true },
    lastTestAt: Date,
    lastTestStatus: { type: String, enum: ['success', 'failed'] },
    lastTestError: String,
  },
  { timestamps: true },
)

export const EmailConfig =
  mongoose.models.EmailConfig || mongoose.model('EmailConfig', EmailConfigSchema)
