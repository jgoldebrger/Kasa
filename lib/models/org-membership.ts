import mongoose, { Schema } from 'mongoose'

const OrgMembershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'treasurer', 'communications'],
      required: true,
      default: 'member',
    },
  },
  { timestamps: true },
)
OrgMembershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true })

export const OrgMembership =
  mongoose.models.OrgMembership || mongoose.model('OrgMembership', OrgMembershipSchema)
