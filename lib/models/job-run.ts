import mongoose, { Schema } from 'mongoose'

// Job Run Schema (per-invocation audit for chunked cron jobs).
// Each cron-triggered batch writes one row; recursive self-calls also
// write rows so you can see exactly how a long-running job split up.
const JobRunSchema = new Schema({
  name: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    default: 'running',
    index: true,
  },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: Date,
  // Pagination cursor that was input to this batch (null for first batch).
  cursorIn: String,
  // Cursor handed off to the next batch (null when no more work).
  cursorOut: String,
  processed: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  // Per-item error messages (capped in app code to keep the doc small).
  errors: [{ orgId: String, error: String }],
  lastError: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true, suppressReservedKeysWarning: true })
JobRunSchema.index({ name: 1, startedAt: -1 })
// Retain per-batch job run audit for 90 days. JobRun rows accumulate
// FAST — every chunked cron batch writes one, and recursive
// self-calls write more — so unbounded retention here costs more
// storage than it does forensic value. Anything older than a quarter
// is well past actionable; the higher-level results live in `EmailJob`
// or domain rows.
JobRunSchema.index(
  { startedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90, name: 'job_run_ttl' },
)

export const JobRun = mongoose.models.JobRun || mongoose.model('JobRun', JobRunSchema)
