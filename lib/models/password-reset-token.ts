import mongoose, { Schema } from 'mongoose'

const PasswordResetTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true, index: true },
  // Auto-purge expired tokens — they're useless after `expiresAt` and
  // were previously kept indefinitely.
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: Date,
}, { timestamps: true })

export const PasswordResetToken = mongoose.models.PasswordResetToken || mongoose.model('PasswordResetToken', PasswordResetTokenSchema)
