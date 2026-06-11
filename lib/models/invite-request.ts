import mongoose, { Schema } from 'mongoose'

// InviteRequest Schema — visitors request access to the platform; a SaaS
// owner (platform admin) reviews them. Approval generates a one-time
// `signupCode` that gates the public signup flow.
const InviteRequestSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  name: { type: String, required: true, trim: true },
  message: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  // Generated on approval.
  signupCode: { type: String, index: true, sparse: true },
  // Auto-purge approved-but-never-redeemed requests once the signup
  // code expires. Approval-rejected and unanswered requests don't have
  // `signupCodeExpiresAt` set, so they're unaffected by this TTL.
  signupCodeExpiresAt: { type: Date, index: { expires: 0 } },
  usedAt: Date,
  reviewedById: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  rejectReason: String,
}, { timestamps: true })

export const InviteRequest = mongoose.models.InviteRequest || mongoose.model('InviteRequest', InviteRequestSchema)
