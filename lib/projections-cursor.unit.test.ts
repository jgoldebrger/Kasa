import { describe, it, expect, vi } from 'vitest'
import { Types } from 'mongoose'

vi.mock('./pagination', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pagination')>()
  return {
    ...actual,
    collectCompoundCursorPages: async (
      _loadPage: unknown,
      _baseFilter: unknown,
      field: string,
      _dir: unknown,
      getCursor: (last: Record<string, unknown>) => unknown,
    ) => {
      if (field === 'year') {
        getCursor({ year: 2023, _id: 'y1' })
      }
      return []
    },
  }
})

describe('projections compound cursors', () => {
  it('encodes yearly history cursors', async () => {
    const { setupMongo, teardownMongo } = await import('./test/mongo-memory')
    const { Organization, LifecycleEvent } = await import('./models')
    const { loadDuesRecommendation } = await import('./projections')

    await setupMongo()
    const orgId = new Types.ObjectId()
    const ownerId = new Types.ObjectId()
    await Organization.create({
      _id: orgId,
      name: 'Proj Cursor Org',
      slug: `proj-cursor-${orgId.toString().slice(-8)}`,
      ownerId,
      timezone: 'UTC',
    })
    await LifecycleEvent.create({
      organizationId: orgId,
      type: 'wedding',
      name: 'Wedding',
      amount: 100,
    })

    const out = await loadDuesRecommendation(orgId.toString(), 5, 1, 2030)
    expect(out.perEvent).toHaveLength(1)

    await LifecycleEvent.deleteMany({ organizationId: orgId })
    await Organization.deleteMany({ _id: orgId })
    await teardownMongo()
  })
})
