import { Types } from 'mongoose'
import { Family, EmailMessage } from '@/lib/models'
import { encodeCompoundCursor, decodeCompoundCursor } from '@/lib/pagination'

function formatEmailRow(row: any, familyName?: string) {
  return {
    _id: String(row._id),
    familyId: row.familyId ? String(row.familyId) : null,
    familyName: familyName ?? null,
    to: row.to,
    subject: row.subject,
    kind: row.kind,
    status: row.status,
    openCount: row.openCount ?? 0,
    clickCount: row.clickCount ?? 0,
    error: row.error ?? null,
    createdAt: row.createdAt,
    firstOpenedAt: row.firstOpenedAt ?? null,
    firstClickedAt: row.firstClickedAt ?? null,
  }
}

export async function listOrgEmails(
  organizationId: string,
  query: {
    familyId?: string
    kind?: string
    status?: string
    limit?: number
    cursor?: string
  },
) {
  const limit = query.limit ?? 50
  const filter: Record<string, unknown> = { organizationId: new Types.ObjectId(organizationId) }
  if (query.familyId) filter.familyId = new Types.ObjectId(query.familyId)
  if (query.kind) filter.kind = query.kind
  if (query.status) filter.status = query.status

  if (query.cursor) {
    const cur = decodeCompoundCursor(query.cursor)
    if (cur?.v != null && cur.id) {
      filter.$or = [
        { createdAt: { $lt: new Date(cur.v) } },
        { createdAt: new Date(cur.v), _id: { $lt: new Types.ObjectId(cur.id) } },
      ]
    }
  }

  const rows = await EmailMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<any[]>()

  let nextCursor: string | null = null
  let page = rows
  if (rows.length > limit) {
    page = rows.slice(0, limit)
    const last = page[page.length - 1]
    if (last) {
      nextCursor = encodeCompoundCursor({
        v: last.createdAt ? new Date(last.createdAt).getTime() : null,
        id: String(last._id),
      })
    }
  }

  const familyIds = [
    ...new Set(
      page
        .map((r) => r.familyId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const families = familyIds.length
    ? await Family.find({
        organizationId,
        _id: { $in: familyIds },
      })
        .select('name')
        .lean<{ _id: Types.ObjectId; name?: string }[]>()
    : []
  const familyNames = new Map(families.map((f) => [String(f._id), f.name ?? '']))

  return {
    items: page.map((r) =>
      formatEmailRow(r, r.familyId ? familyNames.get(String(r.familyId)) : undefined),
    ),
    nextCursor,
  }
}
