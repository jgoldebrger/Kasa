import { describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'

const familyFindMock = vi.hoisted(() => vi.fn())
const familyMemberFindMock = vi.hoisted(() => vi.fn())

vi.mock('./models', () => ({
  Family: { find: (...args: unknown[]) => familyFindMock(...args) },
  FamilyMember: { find: (...args: unknown[]) => familyMemberFindMock(...args) },
}))

import {
  familyBatches,
  familyMemberBatches,
  loadAllByIdCursor,
  loadByIdsInChunks,
} from './org-pagination'

type IdRow = { _id: Types.ObjectId; label: string }

function makeAscendingRows(count: number): IdRow[] {
  return Array.from({ length: count }, (_, i) => {
    const hex = (i + 1).toString(16).padStart(24, '0')
    return { _id: new Types.ObjectId(hex), label: `row-${i}` }
  })
}

describe('loadAllByIdCursor', () => {
  it('returns every row across batches larger than 1000', async () => {
    const total = 2500
    const rows = makeAscendingRows(total)

    const loadBatch = async (filter: Record<string, unknown>, limit: number) => {
      let start = 0
      if (filter._id && typeof filter._id === 'object') {
        const gt = (filter._id as { $gt: Types.ObjectId }).$gt
        const idx = rows.findIndex((r) => String(r._id) === String(gt))
        start = idx >= 0 ? idx + 1 : 0
      }
      return rows.slice(start, start + limit)
    }

    const out = await loadAllByIdCursor(loadBatch, { org: 'test' }, 1000)
    expect(out).toHaveLength(total)
    expect(out.map((r) => r.label)).toEqual(rows.map((r) => r.label))
  })
})

describe('loadByIdsInChunks', () => {
  it('loads all ids when count exceeds the chunk size', async () => {
    const ids = Array.from({ length: 2500 }, (_, i) =>
      new Types.ObjectId((i + 1).toString(16).padStart(24, '0')).toString(),
    )
    const seen: string[] = []

    const loadChunk = async (chunkIds: Types.ObjectId[]) => {
      seen.push(...chunkIds.map(String))
      return chunkIds.map((id) => ({ _id: id }))
    }

    const out = await loadByIdsInChunks(loadChunk, ids, 1000)
    expect(out).toHaveLength(2500)
    expect(seen).toHaveLength(2500)
    expect(new Set(seen).size).toBe(2500)
  })
})

describe('familyBatches', () => {
  it('yields multiple batches and advances the _id cursor', async () => {
    const rows = makeAscendingRows(2500)
    familyFindMock.mockImplementation((filter: Record<string, unknown>) => {
      let start = 0
      if (filter._id && typeof filter._id === 'object') {
        const gt = (filter._id as { $gt: Types.ObjectId }).$gt
        const idx = rows.findIndex((r) => String(r._id) === String(gt))
        start = idx >= 0 ? idx + 1 : 0
      }
      return {
        sort: () => ({
          limit: (n: number) => ({
            lean: async () => rows.slice(start, start + n),
          }),
        }),
      }
    })

    const collected: IdRow[] = []
    for await (const batch of familyBatches('org-1', { batchSize: 1000 })) {
      collected.push(...(batch as IdRow[]))
    }

    expect(collected).toHaveLength(2500)
    expect(familyFindMock.mock.calls.length).toBeGreaterThan(1)
    expect(familyFindMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        _id: { $gt: rows[999]._id },
      }),
    )
  })
})

describe('familyMemberBatches', () => {
  it('yields member batches with cursor continuation', async () => {
    const rows = makeAscendingRows(2500)
    familyMemberFindMock.mockImplementation((filter: Record<string, unknown>) => {
      let start = 0
      if (filter._id && typeof filter._id === 'object') {
        const gt = (filter._id as { $gt: Types.ObjectId }).$gt
        const idx = rows.findIndex((r) => String(r._id) === String(gt))
        start = idx >= 0 ? idx + 1 : 0
      }
      return {
        sort: () => ({
          limit: (n: number) => ({
            lean: async () => rows.slice(start, start + n),
          }),
        }),
      }
    })

    const collected: IdRow[] = []
    for await (const batch of familyMemberBatches('org-1', { active: true }, { batchSize: 1000 })) {
      collected.push(...(batch as IdRow[]))
    }

    expect(collected).toHaveLength(2500)
    expect(familyMemberFindMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        active: true,
        _id: { $gt: rows[999]._id },
      }),
    )
  })
})
