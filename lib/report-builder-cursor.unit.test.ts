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
      if (field === 'paymentDate') {
        getCursor({ _id: '1' })
        getCursor({ paymentDate: new Date('2024-01-01'), _id: '2' })
      }
      if (field === 'eventDate') {
        getCursor({ _id: '3' })
        getCursor({ eventDate: new Date('2024-01-01'), _id: '4' })
      }
      if (field === 'name') {
        getCursor({ name: 123, _id: '5' })
        getCursor({ name: 'Cohen', _id: '6' })
      }
      return []
    },
  }
})

describe('report-builder compound cursors', () => {
  it('encodes sparse last rows for payments, events, and families', async () => {
    const { setupMongo, teardownMongo } = await import('./test/mongo-memory')
    const { Organization } = await import('./models')
    const { runReport } = await import('./report-builder')

    await setupMongo()
    const orgId = new Types.ObjectId()
    const ownerId = new Types.ObjectId()
    await Organization.create({
      _id: orgId,
      name: 'Cursor Unit Org',
      slug: `cursor-unit-${orgId.toString().slice(-8)}`,
      ownerId,
    })

    await runReport({ source: 'payments', aggregate: 'count' }, orgId.toString())
    await runReport({ source: 'events', aggregate: 'count' }, orgId.toString())
    await runReport({ source: 'families', aggregate: 'count' }, orgId.toString())

    await Organization.deleteMany({ _id: orgId })
    await teardownMongo()
    expect(true).toBe(true)
  })
})
