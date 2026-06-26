import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { Family, EmailMessage } from '@/lib/models'
import { encodeCompoundCursor, decodeCompoundCursor } from '@/lib/pagination'

function errorFromRow(row: {
  error?: string | null
  events?: Array<{ type?: string; meta?: { message?: string } }>
}): string | null {
  if (row.error) return row.error
  const events = row.events ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev?.type === 'failed' && ev.meta?.message) return String(ev.meta.message)
  }
  return null
}

function csvField(value: string): string {
  const s = String(value ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function formatEmailRow(row: any, familyName?: string, deliverabilityWarning?: boolean) {
  const error = errorFromRow(row)
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
    error,
    campaignId: row.campaignId ? String(row.campaignId) : null,
    deliverabilityWarning: deliverabilityWarning ?? false,
    createdAt: row.createdAt,
    firstOpenedAt: row.firstOpenedAt ?? null,
    firstClickedAt: row.firstClickedAt ?? null,
  }
}

function buildEmailFilter(
  organizationId: string,
  query: {
    familyId?: string
    kind?: string
    status?: string
    dateFrom?: Date
    dateTo?: Date
  },
): Record<string, unknown> {
  const filter: Record<string, unknown> = { organizationId: new Types.ObjectId(organizationId) }
  if (query.familyId) filter.familyId = new Types.ObjectId(query.familyId)
  if (query.kind) filter.kind = query.kind
  if (query.status) filter.status = query.status
  if (query.dateFrom || query.dateTo) {
    const createdAt: Record<string, Date> = {}
    if (query.dateFrom) createdAt.$gte = query.dateFrom
    if (query.dateTo) createdAt.$lte = query.dateTo
    filter.createdAt = createdAt
  }
  return filter
}

async function loadFamilyMaps(
  organizationId: string,
  familyIds: string[],
): Promise<{
  familyNames: Map<string, string>
  deliverabilityByFamily: Map<string, boolean>
}> {
  if (familyIds.length === 0) {
    return { familyNames: new Map(), deliverabilityByFamily: new Map() }
  }
  const families = await Family.find({
    organizationId,
    _id: { $in: familyIds },
  })
    .select('name emailDeliverabilityWarning')
    .lean<{ _id: Types.ObjectId; name?: string; emailDeliverabilityWarning?: boolean }[]>()
  return {
    familyNames: new Map(families.map((f) => [String(f._id), f.name ?? ''])),
    deliverabilityByFamily: new Map(
      families.map((f) => [String(f._id), f.emailDeliverabilityWarning === true]),
    ),
  }
}

export async function exportOrgEmailsCsv(
  organizationId: string,
  query: {
    familyId?: string
    kind?: string
    status?: string
    dateFrom?: Date
    dateTo?: Date
  },
): Promise<NextResponse> {
  const MAX_EXPORT = 10_000
  const filter = buildEmailFilter(organizationId, query)
  const rows = await EmailMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(MAX_EXPORT)
    .lean<any[]>()

  const familyIds = [
    ...new Set(
      rows
        .map((r) => r.familyId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const { familyNames, deliverabilityByFamily } = await loadFamilyMaps(organizationId, familyIds)

  const header = [
    'createdAt',
    'to',
    'subject',
    'kind',
    'status',
    'familyName',
    'familyId',
    'campaignId',
    'error',
    'openCount',
    'clickCount',
  ]
  const lines = [header.join(',')]
  for (const row of rows) {
    const formatted = formatEmailRow(
      row,
      row.familyId ? familyNames.get(String(row.familyId)) : undefined,
      row.familyId ? deliverabilityByFamily.get(String(row.familyId)) : undefined,
    )
    lines.push(
      [
        formatted.createdAt ? new Date(formatted.createdAt).toISOString() : '',
        csvField(formatted.to || ''),
        csvField(formatted.subject || ''),
        csvField(formatted.kind || ''),
        csvField(formatted.status || ''),
        csvField(formatted.familyName || ''),
        formatted.familyId || '',
        formatted.campaignId || '',
        csvField(formatted.error || ''),
        String(formatted.openCount ?? 0),
        String(formatted.clickCount ?? 0),
      ].join(','),
    )
  }

  const csv = lines.join('\n')
  const filename = `sent-emails-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function listOrgEmails(
  organizationId: string,
  query: {
    familyId?: string
    kind?: string
    status?: string
    dateFrom?: Date
    dateTo?: Date
    limit?: number
    cursor?: string
  },
) {
  const limit = query.limit ?? 50
  const filter = buildEmailFilter(organizationId, query)

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
  const { familyNames, deliverabilityByFamily } = await loadFamilyMaps(organizationId, familyIds)

  return {
    items: page.map((r) =>
      formatEmailRow(
        r,
        r.familyId ? familyNames.get(String(r.familyId)) : undefined,
        r.familyId ? deliverabilityByFamily.get(String(r.familyId)) : undefined,
      ),
    ),
    nextCursor,
  }
}
