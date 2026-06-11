/**
 * Distributed advisory lock for cron-style jobs.
 *
 * Why this exists: Vercel Cron is "at least once" delivery, our own
 * worker chunks can self-retrigger, and an on-call operator can
 * manually hit the same endpoint. Without a lock the cycle-rollover
 * job (one-shot once a year) and the monthly statement generator
 * (one-shot once a month) could each fire twice for the same logical
 * tick, doubling charges or producing duplicate statement rows.
 *
 * The lock is keyed by `(jobName, lockKey)`. Use `lockKey` to bind the
 * lock to the logical tick you're protecting — typically the ISO date,
 * e.g. `2026-01-01` for cycle-rollover or `2026-02` for monthly
 * statements. Two requests with the same key race on a unique index
 * and only one wins.
 *
 * Locks carry an `expiresAt` so a crashed worker eventually frees the
 * slot. The model also has a TTL index that deletes expired locks
 * automatically.
 */

import { JobLock } from './models'
import connectDB from './database'

export interface AcquireOptions {
  /** Lifetime in ms. Default: 15 minutes — long enough for most chunked jobs. */
  ttlMs?: number
  /** Free-form owner tag (e.g. process pid + hostname) for debugging. */
  owner?: string
  /** Free-form metadata persisted alongside the lock. */
  metadata?: Record<string, unknown>
}

export interface CronLock {
  /** Release the lock now (idempotent — safe to call from finally{}). */
  release(): Promise<void>
}

/**
 * Try to take a lock. Returns `null` when another holder already has
 * an unexpired lock, or a `CronLock` whose `.release()` frees it.
 *
 * Callers should always wrap their work in
 *   const lock = await acquireCronLock(...)
 *   if (!lock) return // someone else is running
 *   try { ... } finally { await lock.release() }
 */
export async function acquireCronLock(
  jobName: string,
  lockKey: string,
  opts: AcquireOptions = {},
): Promise<CronLock | null> {
  await connectDB()
  const now = new Date()
  const ttl = Number.isFinite(opts.ttlMs) && opts.ttlMs! > 0 ? opts.ttlMs! : 15 * 60 * 1000
  const expiresAt = new Date(now.getTime() + ttl)

  try {
    // Try to take a fresh lock. The unique index on (jobName, lockKey)
    // does the actual mutual exclusion — only the first writer wins.
    const created = await JobLock.create({
      jobName,
      lockKey,
      acquiredAt: now,
      expiresAt,
      owner: opts.owner,
      metadata: opts.metadata,
    })
    return makeReleaser(created._id)
  } catch (err: any) {
    if (err?.code !== 11000) throw err
    // Conflict — but the existing lock may already have expired (a
    // previous worker crashed without releasing). Try to steal it
    // atomically: only succeed if the row we're updating is in fact
    // past its expiry, otherwise back off.
    const stolen = await JobLock.findOneAndUpdate(
      { jobName, lockKey, expiresAt: { $lt: now } },
      {
        $set: {
          acquiredAt: now,
          expiresAt,
          owner: opts.owner,
          metadata: opts.metadata,
        },
      },
      { new: true },
    )
    if (stolen) return makeReleaser(stolen._id)
    return null
  }
}

function makeReleaser(id: unknown): CronLock {
  let released = false
  return {
    async release() {
      if (released) return
      released = true
      try {
        await JobLock.deleteOne({ _id: id })
      } catch {
        // Best-effort — the TTL index will sweep it up eventually.
      }
    },
  }
}

/**
 * Convenience wrapper: take the lock, run the function, always release.
 * Returns the function's return value, or `null` if the lock could not
 * be acquired.
 */
export async function withCronLock<T>(
  jobName: string,
  lockKey: string,
  fn: () => Promise<T>,
  opts: AcquireOptions = {},
): Promise<T | null> {
  const lock = await acquireCronLock(jobName, lockKey, opts)
  if (!lock) return null
  try {
    return await fn()
  } finally {
    await lock.release()
  }
}
