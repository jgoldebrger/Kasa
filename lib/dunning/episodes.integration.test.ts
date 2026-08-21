import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

describe('DunningEpisode model', () => {
  beforeAll(async () => {
    await setupMongo()
    const { DunningEpisode } = await import('@/lib/models')
    await DunningEpisode.syncIndexes()
  })
  afterAll(async () => {
    await teardownMongo()
  })
  afterEach(async () => {
    const { DunningEpisode } = await import('@/lib/models')
    await DunningEpisode.deleteMany({})
  })

  it('rejects a second open episode for the same org/family/rule', async () => {
    const { DunningEpisode } = await import('@/lib/models')
    await DunningEpisode.syncIndexes()
    const organizationId = new Types.ObjectId()
    const familyId = new Types.ObjectId()
    const ruleId = new Types.ObjectId()
    await DunningEpisode.create({ organizationId, familyId, ruleId, status: 'open' })
    await expect(
      DunningEpisode.create({ organizationId, familyId, ruleId, status: 'open' }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  describe('planDunningAction', () => {
    it('opens and sends on first qualify', async () => {
      const { planDunningAction, latestEpisode } = await import('./episodes')
      const organizationId = new Types.ObjectId().toString()
      const familyId = new Types.ObjectId().toString()
      const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
      const result = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-01T12:00:00.000Z'),
        timezone: 'UTC',
      })
      expect(result.action).toBe('send')
      const ep = await latestEpisode({ organizationId, familyId, ruleId: String(rule._id) })
      expect(ep?.status).toBe('open')
      expect(ep?.sendCount).toBe(0)
    })

    it('skips when last send was fewer than intervalDays ago', async () => {
      const { planDunningAction, recordSuccessfulDunningSend } = await import('./episodes')
      const organizationId = new Types.ObjectId().toString()
      const familyId = new Types.ObjectId().toString()
      const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
      const first = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-01T12:00:00.000Z'),
        timezone: 'UTC',
      })
      if (first.action !== 'send') throw new Error('expected send')
      await recordSuccessfulDunningSend({
        episodeId: first.episodeId,
        now: new Date('2026-08-01T12:00:00.000Z'),
        maxAttempts: 3,
      })
      const second = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-03T12:00:00.000Z'),
        timezone: 'UTC',
      })
      expect(second.action).toBe('skip')
    })

    it('closes on payment and does not send again until intervalDays pass', async () => {
      const { planDunningAction, recordSuccessfulDunningSend, closeDunningEpisodesForPayment } =
        await import('./episodes')
      const organizationId = new Types.ObjectId().toString()
      const familyId = new Types.ObjectId().toString()
      const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
      const first = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-01T12:00:00.000Z'),
        timezone: 'UTC',
      })
      if (first.action !== 'send') throw new Error('expected send')
      await recordSuccessfulDunningSend({
        episodeId: first.episodeId,
        now: new Date('2026-08-01T12:00:00.000Z'),
        maxAttempts: 3,
      })
      const closed = await closeDunningEpisodesForPayment({ organizationId, familyId })
      expect(closed).toBe(1)
      const tooSoon = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-03T12:00:00.000Z'),
        timezone: 'UTC',
      })
      expect(tooSoon.action).toBe('skip')
      const later = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-09T12:00:00.000Z'),
        timezone: 'UTC',
      })
      expect(later.action).toBe('send')
    })

    it('closes with no_longer_qualifies when qualifies is false and an episode is open', async () => {
      const { planDunningAction, latestEpisode } = await import('./episodes')
      const organizationId = new Types.ObjectId().toString()
      const familyId = new Types.ObjectId().toString()
      const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
      const first = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: true,
        now: new Date('2026-08-01T12:00:00.000Z'),
        timezone: 'UTC',
      })
      if (first.action !== 'send') throw new Error('expected send')
      const closed = await planDunningAction({
        organizationId,
        familyId,
        rule,
        qualifies: false,
        now: new Date('2026-08-02T12:00:00.000Z'),
        timezone: 'UTC',
      })
      expect(closed).toEqual({ action: 'close', reason: 'no_longer_qualifies' })
      const ep = await latestEpisode({ organizationId, familyId, ruleId: String(rule._id) })
      expect(ep?.status).toBe('closed')
    })
  })
})
