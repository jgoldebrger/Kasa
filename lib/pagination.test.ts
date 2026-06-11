import { describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import {
  collectCompoundCursorPages,
  compoundCursorFilter,
  decodeCompoundCursor,
  encodeCompoundCursor,
} from './pagination'

describe('encodeCompoundCursor / decodeCompoundCursor', () => {
  it('round-trips a compound cursor', () => {
    const id = new Types.ObjectId().toString()
    const raw = encodeCompoundCursor({ v: 1_700_000_000_000, id })
    expect(decodeCompoundCursor(raw)).toEqual({ v: 1_700_000_000_000, id })
  })

  it('rejects cursors whose v is an object (NoSQL injection guard)', () => {
    const id = new Types.ObjectId().toString()
    const malicious = Buffer.from(JSON.stringify({ v: { $ne: null }, id }), 'utf8').toString(
      'base64url',
    )
    expect(decodeCompoundCursor(malicious)).toBeNull()
  })

  it('rejects invalid object ids', () => {
    const raw = encodeCompoundCursor({ v: 1, id: 'not-an-object-id' })
    expect(decodeCompoundCursor(raw)).toBeNull()
  })

  it('returns null for malformed base64 payloads', () => {
    expect(decodeCompoundCursor('not-valid-base64!!!')).toBeNull()
  })

  it('returns null when decoded JSON is not an object', () => {
    const raw = Buffer.from('null', 'utf8').toString('base64url')
    expect(decodeCompoundCursor(raw)).toBeNull()
  })

  it('returns null when the payload omits id', () => {
    const raw = Buffer.from(JSON.stringify({ v: 1 }), 'utf8').toString('base64url')
    expect(decodeCompoundCursor(raw)).toBeNull()
  })
})

describe('compoundCursorFilter', () => {
  it('builds descending resume filter with sort-field tiebreak', () => {
    const id = new Types.ObjectId().toString()
    const f = compoundCursorFilter('paymentDate', 100, id, -1)
    expect(f).toEqual({
      $or: [
        { paymentDate: { $lt: 100 } },
        { paymentDate: 100, _id: { $lt: new Types.ObjectId(id) } },
      ],
    })
  })

  it('uses only _id when the sort value cursor is null', () => {
    const id = new Types.ObjectId().toString()
    expect(compoundCursorFilter('paymentDate', null, id, -1)).toEqual({
      _id: { $lt: new Types.ObjectId(id) },
    })
  })

  it('builds ascending resume filter when direction is 1', () => {
    const id = new Types.ObjectId().toString()
    expect(compoundCursorFilter('paymentDate', 100, id, 1)).toEqual({
      $or: [
        { paymentDate: { $gt: 100 } },
        { paymentDate: 100, _id: { $gt: new Types.ObjectId(id) } },
      ],
    })
  })
})

type ScoreRow = { _id: Types.ObjectId; score: number }

function sortScoreDesc(rows: ScoreRow[]): ScoreRow[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return String(b._id).localeCompare(String(a._id))
  })
}

function matchesScoreFilter(row: ScoreRow, filter: Record<string, unknown>): boolean {
  if (filter.$or && Array.isArray(filter.$or)) {
    return (filter.$or as Record<string, unknown>[]).some((clause) =>
      matchesScoreFilter(row, clause),
    )
  }
  if (filter.score !== undefined && typeof filter.score === 'object' && filter.score !== null) {
    const op = (filter.score as Record<string, number>)['$lt']
    if (op !== undefined && !(row.score < op)) return false
  }
  if (
    filter.score !== undefined &&
    typeof filter.score === 'number' &&
    filter._id &&
    typeof filter._id === 'object'
  ) {
    const idOp = (filter._id as Record<string, Types.ObjectId>)['$lt']
    if (row.score !== filter.score) return false
    if (idOp && String(row._id) >= String(idOp)) return false
  }
  return true
}

describe('collectCompoundCursorPages', () => {
  it('collects all rows when the loader spans multiple batches', async () => {
    const batchSize = 1000
    const total = 2500
    const rows = sortScoreDesc(
      Array.from({ length: total }, (_, i) => ({
        _id: new Types.ObjectId(),
        score: total - i,
      })),
    )

    const loadPage = async (filter: Record<string, unknown>, limit: number) => {
      const page = rows.filter((r) => matchesScoreFilter(r, filter)).slice(0, limit)
      return page
    }

    const out = await collectCompoundCursorPages(
      loadPage,
      {},
      'score',
      -1,
      (last) => ({ v: last.score, id: String((last as ScoreRow)._id) }),
      batchSize,
    )

    expect(out).toHaveLength(total)
    expect(out.map((r) => r.score)).toEqual(rows.map((r) => r.score))
  })

  it('does not drop rows that share the same sort value (tiebreak on _id)', async () => {
    const shared = 50
    const idA = new Types.ObjectId('000000000000000000000001')
    const idB = new Types.ObjectId('000000000000000000000002')
    const idC = new Types.ObjectId('000000000000000000000003')
    const rows: ScoreRow[] = [
      { _id: idC, score: shared },
      { _id: idB, score: shared },
      { _id: idA, score: shared },
      { _id: new Types.ObjectId('000000000000000000000004'), score: shared - 1 },
    ]
    const sorted = sortScoreDesc(rows)

    const loadPage = async (filter: Record<string, unknown>, limit: number) =>
      sorted.filter((r) => matchesScoreFilter(r, filter)).slice(0, limit)

    const out = await collectCompoundCursorPages(
      loadPage,
      {},
      'score',
      -1,
      (last) => ({ v: last.score, id: String(last._id) }),
      2,
    )

    expect(out).toHaveLength(4)
    expect(out.map((r) => String(r._id))).toEqual(sorted.map((r) => String(r._id)))
  })

  it('returns an empty array when the loader yields no rows', async () => {
    const out = await collectCompoundCursorPages(
      async () => [],
      {},
      'score',
      -1,
      (last) => ({ v: (last as ScoreRow).score, id: String((last as ScoreRow)._id) }),
      10,
    )
    expect(out).toEqual([])
  })
})
