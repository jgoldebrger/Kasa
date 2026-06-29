import mongoose, { Schema } from 'mongoose'

const InviteSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'treasurer', 'communications'],
      required: true,
      default: 'member',
    },
    // SHA-256 hash of the bearer token (see lib/invite-token.ts). Legacy rows
    // may still hold cleartext until they expire.
    token: { type: String, required: true, unique: true, index: true },
    invitedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: Date,
    // TTL: documents are purged automatically once `expiresAt` is in the
    // past. Without this, expired invites accumulated forever, and a
    // long-lived but never-redeemed invite remained physically present
    // (and indexed) in the collection.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
)
InviteSchema.index({ organizationId: 1, email: 1 })

export const Invite = mongoose.models.Invite || mongoose.model('Invite', InviteSchema)
