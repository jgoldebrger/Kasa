import mongoose, { Schema } from 'mongoose'
import type { OrgPermission } from '@/types/auth'

const OrgApiKeySchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** First 12 chars of the key for display (e.g. `kasa_abc12345`). */
    prefix: { type: String, required: true, trim: true, maxlength: 16 },
    /** SHA-256 of the full bearer token — see lib/org-api-key-token.ts. */
    keyHash: { type: String, required: true, unique: true, index: true },
    scopes: {
      type: [String],
      enum: ['families:read', 'payments:read'],
      required: true,
      default: ['families:read', 'payments:read'],
    },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

OrgApiKeySchema.index({ organizationId: 1, revokedAt: 1, createdAt: -1 })

export const OrgApiKey = mongoose.models.OrgApiKey || mongoose.model('OrgApiKey', OrgApiKeySchema)

export type OrgApiKeyScope = OrgPermission
