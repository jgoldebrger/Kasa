import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const StatementSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember' }, // Optional: for member-specific statements
  statementNumber: { type: String, required: true },
  date: { type: Date, required: true },
  fromDate: { type: Date, required: true },
  toDate: { type: Date, required: true },
  openingBalance: { type: Number, required: true },
  income: { type: Number, required: true },
  withdrawals: { type: Number, required: true },
  expenses: { type: Number, required: true },
  // Sum of CycleCharges falling in the statement period. Defaults to 0
  // for back-compat with pre-rollover statements. Subtracted from the
  // closing balance just like withdrawals, so opening balances of
  // subsequent statements (re-computed via `calculateFamilyBalance`)
  // stay consistent with what the statement reported.
  cycleCharges: { type: Number, default: 0 },
  closingBalance: { type: Number, required: true },
}, { timestamps: true })
StatementSchema.index({ organizationId: 1, date: -1 })
// Per-family statement listing — `family.detail` page and per-member
// statement endpoint both filter by familyId and sort by `date desc`.
StatementSchema.index({ organizationId: 1, familyId: 1, date: -1 })
// Idempotency: a family should never get two statements covering the
// exact same period. Bulk send-emails / monthly cron previously could
// duplicate on every re-run; this partial unique index makes that
// arithmetically impossible. Partial-filtered to ignore soft-deleted
// rows so restored history doesn't conflict with re-issued runs.
StatementSchema.index(
  { organizationId: 1, familyId: 1, fromDate: 1, toDate: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
// Human-facing statement numbers must be unique within an org. The
// atomic `nextCounter` sequence prevents the common race, but imports
// / manual DB edits can still collide — this index makes duplicates
// impossible at the DB layer. Partial-filtered like the period index
// so a soft-deleted row doesn't block re-issuing the same number
// after restore.
StatementSchema.index(
  { organizationId: 1, statementNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
StatementSchema.plugin(softDeletePlugin)

export const Statement = mongoose.models.Statement || mongoose.model('Statement', StatementSchema)
