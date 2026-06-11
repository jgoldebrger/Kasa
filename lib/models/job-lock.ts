import mongoose, { Schema } from 'mongoose'

/**
 * Distributed advisory lock for cron-style jobs.
 *
 * Used by `lib/cron-lock.ts` to ensure that a single nominal job
 * (e.g. "cycle-rollover" on 2026-01-01, or "monthly-statements" on
 * 2026-02-01) never has two concurrent invocations — Vercel's cron
 * "at-least-once" guarantee plus our own manual triggers and worker
 * retries can otherwise have two ticks racing the same recurring
 * billing tick, the same statement generation, etc.
 *
 * The `{ jobName, lockKey }` pair is unique. Each lock has an explicit
 * `expiresAt` so a crashed worker eventually releases the lock without
 * manual intervention. We additionally use TTL index on `expiresAt` so
 * Mongo cleans rows up automatically.
 */
const JobLockSchema = new Schema(
  {
    jobName: { type: String, required: true },
    lockKey: { type: String, required: true },
    acquiredAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    owner: { type: String },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
)
JobLockSchema.index({ jobName: 1, lockKey: 1 }, { unique: true })
JobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const JobLock = mongoose.models.JobLock || mongoose.model('JobLock', JobLockSchema)
