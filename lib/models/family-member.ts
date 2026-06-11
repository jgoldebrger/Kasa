import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const FamilyMemberSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  firstName: { type: String, required: true },
  hebrewFirstName: String, // Required in frontend, optional in schema for backward compatibility
  lastName: { type: String, required: true },
  hebrewLastName: String, // Required in frontend, optional in schema for backward compatibility
  birthDate: Date,
  hebrewBirthDate: String,
  gender: String,
  barMitzvahDate: Date,
  batMitzvahDate: Date,
  weddingDate: Date,
  spouseName: String, // Keep for backward compatibility
  // Spouse information fields (for auto-conversion)
  spouseFirstName: String,
  spouseHebrewName: String,
  spouseFatherHebrewName: String,
  spouseCellPhone: String,
  phone: String, // Phone for the new family
  email: String, // Email for the new family
  address: String, // Address for the new family
  city: String, // City for the new family
  state: String, // State for the new family
  zip: String, // ZIP for the new family
  paymentPlan: Number, // Keep for backward compatibility
  paymentPlanId: { type: Schema.Types.ObjectId, ref: 'PaymentPlan' }, // Reference to PaymentPlan by ID
  paymentPlanAssigned: { type: Boolean, default: false },
  // Idempotency flag for the Bar Mitzvah auto-event hook (see the
  // member create + update routes). Without this declared, Mongoose's
  // strict mode silently dropped the write — so every PUT on a male
  // member with a `barMitzvahDate` would add ANOTHER
  // `LifecycleEventPayment` row whenever the org had
  // `barMitzvahAutoCreateEventTypeId` configured.
  barMitzvahEventAdded: { type: Boolean, default: false },
  // Tombstone flag for the wedding-day auto-conversion (see
  // `lib/wedding-converter.ts`). Set to `true` on the original member
  // row once it has been promoted into its own Family. The cron filters
  // on `convertedToFamily: { $ne: true }` so a member is never
  // re-promoted — without this field declared on the schema Mongoose's
  // strict mode would silently drop the write and the converter could
  // create duplicate families on retry.
  convertedToFamily: { type: Boolean, default: false },
  notes: String,
}, { timestamps: true })
FamilyMemberSchema.index({ organizationId: 1, familyId: 1 })
// Wedding-converter cron filters by `organizationId + weddingDate +
// convertedToFamily`. Without this index it tabled-scanned every
// member each daily run.
FamilyMemberSchema.index({ organizationId: 1, weddingDate: 1, convertedToFamily: 1 })
FamilyMemberSchema.plugin(softDeletePlugin)

export const FamilyMember = mongoose.models.FamilyMember || mongoose.model('FamilyMember', FamilyMemberSchema)
