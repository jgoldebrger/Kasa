import mongoose, { Schema } from 'mongoose'

// Email Job Schema (tracks long-running bulk-email sends so the user's
// "Send via Email" click returns immediately while the work runs in the
// background via chunked self-calls).
const EmailJobSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  kind: { type: String, enum: ['statements', 'tax-receipts'], default: 'statements' },
  // Year context for tax-receipt jobs. Unused for `kind: 'statements'`,
  // which uses `fromDate`/`toDate` instead.
  year: { type: Number },
  status: {
    type: String,
    enum: ['queued', 'running', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  fromDate: Date,
  toDate: Date,
  totalFamilies: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  // Family ids still to process; the worker pops a batch off the front
  // each invocation. Kept in the doc so each chunk only re-reads one row.
  pending: [Schema.Types.ObjectId],
  errors: [{ familyId: String, email: String, error: String }],
  lastError: String,
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true, suppressReservedKeysWarning: true })
EmailJobSchema.index({ organizationId: 1, createdAt: -1 })
// Retain EmailJob rows for 30 days. The status endpoint reads recent
// runs for the "send progress" UI; anything older is just noise. The
// stale-running sweeper (lib/email-jobs.ts) already flips abandoned
// jobs to `failed`, so this TTL is the second half of the
// housekeeping story — without it, every bulk send accumulates a row
// forever (statements alone: 12 rows/year per org, plus tax receipts,
// plus ad-hoc re-sends). 30 days easily covers the "did last month's
// statement send actually finish?" question while keeping volume
// bounded.
EmailJobSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30, name: 'email_job_ttl' },
)

export const EmailJob = mongoose.models.EmailJob || mongoose.model('EmailJob', EmailJobSchema)
