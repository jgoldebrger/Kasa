import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('cron-lock (integration)', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { JobLock } = await import('./models')
    await JobLock.deleteMany({})
  })

  it('acquireCronLock inserts a JobLock and release removes it', async () => {
    const { acquireCronLock } = await import('./cron-lock')
    const { JobLock } = await import('./models')

    const lock = await acquireCronLock('cycle-rollover', '2026-01-01', {
      owner: 'test-worker',
      ttlMs: 60_000,
    })
    expect(lock).not.toBeNull()

    const rows = await JobLock.find({ jobName: 'cycle-rollover', lockKey: '2026-01-01' })
    expect(rows).toHaveLength(1)
    expect(rows[0].owner).toBe('test-worker')

    await lock!.release()
    expect(await JobLock.countDocuments({ jobName: 'cycle-rollover' })).toBe(0)
  })

  it('returns null when an unexpired lock is already held', async () => {
    const { acquireCronLock } = await import('./cron-lock')

    const first = await acquireCronLock('monthly-statements', '2026-02', { ttlMs: 60_000 })
    expect(first).not.toBeNull()

    const second = await acquireCronLock('monthly-statements', '2026-02', { ttlMs: 60_000 })
    expect(second).toBeNull()

    await first!.release()
  })

  it('steals an expired lock', async () => {
    const { acquireCronLock } = await import('./cron-lock')
    const { JobLock } = await import('./models')

    const past = new Date(Date.now() - 60_000)
    await JobLock.create({
      jobName: 'wedding-converter',
      lockKey: '2026-03-01',
      acquiredAt: past,
      expiresAt: new Date(Date.now() - 1_000),
      owner: 'stale-worker',
    })

    const lock = await acquireCronLock('wedding-converter', '2026-03-01', {
      owner: 'fresh-worker',
      ttlMs: 60_000,
    })
    expect(lock).not.toBeNull()

    const row = await JobLock.findOne({ jobName: 'wedding-converter', lockKey: '2026-03-01' })
    expect(row!.owner).toBe('fresh-worker')

    await lock!.release()
  })

  it('release is idempotent', async () => {
    const { acquireCronLock } = await import('./cron-lock')

    const lock = await acquireCronLock('process-recurring', 'tick-1', { ttlMs: 60_000 })
    expect(lock).not.toBeNull()

    await lock!.release()
    await expect(lock!.release()).resolves.toBeUndefined()
  })

  it('withCronLock runs the callback and releases the lock', async () => {
    const { withCronLock } = await import('./cron-lock')
    const { JobLock } = await import('./models')

    const result = await withCronLock('generate-statements', '2026-04', async () => {
      const held = await JobLock.countDocuments({ jobName: 'generate-statements' })
      expect(held).toBe(1)
      return { processed: 3 }
    }, { ttlMs: 60_000 })

    expect(result).toEqual({ processed: 3 })
    expect(await JobLock.countDocuments({ jobName: 'generate-statements' })).toBe(0)
  })

  it('withCronLock returns null when the lock cannot be acquired', async () => {
    const { acquireCronLock, withCronLock } = await import('./cron-lock')

    const held = await acquireCronLock('send-monthly', '2026-05', { ttlMs: 60_000 })
    expect(held).not.toBeNull()

    const result = await withCronLock('send-monthly', '2026-05', async () => 'never')
    expect(result).toBeNull()

    await held!.release()
  })
})
