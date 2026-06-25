import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const FamilySchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    hebrewName: String, // Required in frontend, optional in schema for backward compatibility
    weddingDate: { type: Date, required: true },
    husbandFirstName: String,
    husbandHebrewName: String, // Required in frontend, optional in schema for backward compatibility
    husbandFatherHebrewName: String, // Husband's father's Hebrew first name
    wifeFirstName: String,
    wifeHebrewName: String, // Required in frontend, optional in schema for backward compatibility
    wifeFatherHebrewName: String, // Wife's father's Hebrew first name
    husbandCellPhone: String,
    wifeCellPhone: String,
    address: String,
    street: String,
    phone: String,
    email: String,
    city: String,
    state: String,
    zip: String,
    currentPlan: { type: Number, default: 1 }, // Keep for backward compatibility
    paymentPlanId: { type: Schema.Types.ObjectId, ref: 'PaymentPlan' }, // Reference to PaymentPlan by ID
    currentPayment: { type: Number, default: 0 }, // Keep for backward compatibility
    openBalance: { type: Number, default: 0 }, // Deprecated - no longer used in UI, kept for backward compatibility
    parentFamilyId: { type: Schema.Types.ObjectId, ref: 'Family' }, // Reference to parent family (for families created from members)
    // When true, this family is skipped by all bulk statement email flows:
    // the manual "Send via Email" job on the Statements page AND the monthly
    // auto-email cron. Per-family ad-hoc sends from the family page are NOT
    // gated by this — those are deliberate one-off actions by an admin.
    emailOptOut: { type: Boolean, default: false },
    // When true, skip communications bulk sends and scheduled emails.
    // Separate from `emailOptOut` which gates statement/receipt bulk only.
    communicationsOptOut: { type: Boolean, default: false },
    // Set when 3+ send failures to this family's email occur within 7 days.
    emailDeliverabilityWarning: { type: Boolean, default: false },
  },
  { timestamps: true },
)
FamilySchema.index({ organizationId: 1, createdAt: -1 })
// Covers GET /api/families which `sort({ name: 1 })`. Without this Mongo
// has to do an in-memory sort of every family in the org on every list call.
FamilySchema.index({ organizationId: 1, name: 1 })
FamilySchema.plugin(softDeletePlugin)

export const Family = mongoose.models.Family || mongoose.model('Family', FamilySchema)
