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
    const { DunningEpisode, Payment } = await import('@/lib/models')
    await Promise.all([DunningEpisode.deleteMany({}), Payment.deleteMany({})])
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

    it('closes open episode when a payment lands after lastSentAt without the Payment.create hook', async () => {
      const { planDunningAction, recordSuccessfulDunningSend, latestEpisode } =
        await import('./episodes')
      const { DunningEpisode, Payment } = await import('@/lib/models')
      const organizationId = new Types.ObjectId()
      const familyId = new Types.ObjectId()
      const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
      const first = await planDunningAction({
        organizationId: String(organizationId),
        familyId: String(familyId),
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

      await Payment.collection.insertOne({
        organizationId,
        familyId,
        amount: 1,
        paymentDate: new Date('2026-08-08T12:00:00.000Z'),
        deletedAt: null,
        createdAt: new Date('2026-08-08T12:00:00.000Z'),
        updatedAt: new Date('2026-08-08T12:00:00.000Z'),
      })

      const stillOpen = await DunningEpisode.findOne({
        organizationId,
        familyId,
        status: 'open',
      })
      expect(stillOpen).not.toBeNull()

      const planned = await planDunningAction({
        organizationId: String(organizationId),
        familyId: String(familyId),
        rule,
        qualifies: true,
        now: new Date('2026-08-10T12:00:00.000Z'),
        timezone: 'UTC',
      })
      expect(planned).toEqual({ action: 'close', reason: 'payment' })
      const ep = await latestEpisode({
        organizationId: String(organizationId),
        familyId: String(familyId),
        ruleId: String(rule._id),
      })
      expect(ep?.status).toBe('closed')
      const closed = await DunningEpisode.findOne({ organizationId, familyId })
      expect(closed?.closedReason).toBe('payment')
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

  describe('Payment.create closes episodes', () => {
    afterEach(async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({})
    })

    it('closes an open episode when Payment.create saves a row', async () => {
      const { planDunningAction } = await import('./episodes')
      const { DunningEpisode, Payment } = await import('@/lib/models')
      const organizationId = new Types.ObjectId()
      const familyId = new Types.ObjectId()
      const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
      await planDunningAction({
        organizationId: String(organizationId),
        familyId: String(familyId),
        rule,
        qualifies: true,
        now: new Date('2026-08-01T12:00:00.000Z'),
        timezone: 'UTC',
      })

      await Payment.create({
        organizationId,
        familyId,
        amount: 1,
        paymentDate: new Date('2026-08-01T12:00:00.000Z'),
      })

      const deadline = Date.now() + 2000
      let episode = await DunningEpisode.findOne({ organizationId, familyId })
      while (episode?.status !== 'closed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        episode = await DunningEpisode.findOne({ organizationId, familyId })
      }
      expect(episode?.status).toBe('closed')
      expect(episode?.closedReason).toBe('payment')
    })
  })
})
