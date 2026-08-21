import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

describe('DunningEpisode model', () => {
  beforeAll(async () => {
    await setupMongo()
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
})
