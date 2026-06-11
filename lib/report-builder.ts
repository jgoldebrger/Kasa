/**
 * Report builder data layer.
 *
 * Drives the /reports/builder page + /api/reports/run. Defines the
 * available "sources" (payments / events / members / families), their
 * dimensions (group-by candidates) and measures (numeric fields), and
 * runs a single pivot query for a given config.
 *
 * Implementation choices:
 *   - We materialise the source rows in memory and pivot in JS rather
 *     than building a Mongo aggregation pipeline. Reasons:
 *       1) Per-org row counts are small (low thousands max in the wild)
 *       2) JS-side pivoting handles cross-collection joins
 *          (members → family name) without a $lookup
 *       3) Adding a new dimension means a one-line code change instead
 *          of a hand-tuned aggregation
 *   - All queries are scoped to the active org. No cross-tenant leak path.
 *   - Output is always { rows, columns, totals } so the client just
 *     renders — no UI-specific business logic on the server.
 */

import { Types } from 'mongoose'
import { Family, FamilyMember, Payment, LifecycleEventPayment, PaymentPlan, Organization } from './models'
import { netPaymentAmount } from './money'
import { UNBOUNDED_LIST_CAP } from './schemas/common'
import { validateDateRange } from './validate-date-range'
import { getMonthInTimeZone, getYearInTimeZone } from './date-utils'
import { loadAllByIdCursor, familyMemberBatches } from './org-pagination'
import { collectCompoundCursorPages } from './pagination'

function yearMonthInTimeZone(date: Date, tz: string | undefined | null): string {
  const y = getYearInTimeZone(tz, date)
  const m = getMonthInTimeZone(tz, date)
  return `${y}-${String(m).padStart(2, '0')}`
}

export type ReportSource = 'payments' | 'events' | 'members' | 'families'
export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface ReportConfig {
  source: ReportSource
  /** Column id used to group rows. Empty string → no row grouping. */
  rowDim?: string
  /** Column id used to split into columns. Empty string → one column. */
  colDim?: string
  /** Column id whose value is aggregated. Ignored when aggregate === 'count'. */
  measure?: string
  aggregate: Aggregate
  /** ISO date strings; applied to the source's primary date column. */
  fromDate?: string
  toDate?: string
}

export interface ReportColumnDef {
  id: string
  label: string
  /** Column type informs default aggregate + filter UI. */
  type: 'string' | 'number' | 'date'
}

export interface ReportSourceDef {
  id: ReportSource
  label: string
  dateField: string
  dimensions: ReportColumnDef[]
  measures: ReportColumnDef[]
}

/**
 * Static metadata exposed to the UI so the user can pick dimensions
 * without us round-tripping the schema. Order matters for UX (first
 * dimension is the default row).
 */
export const REPORT_SOURCES: ReportSourceDef[] = [
  {
    id: 'payments',
    label: 'Payments',
    // Payment rows use `paymentDate`, not `date`. The mismatch silently
    // dropped the date filter for every payment report.
    dateField: 'paymentDate',
    dimensions: [
      { id: 'familyName', label: 'Family', type: 'string' },
      { id: 'type', label: 'Type', type: 'string' },
      { id: 'method', label: 'Method', type: 'string' },
      { id: 'year', label: 'Year', type: 'string' },
      { id: 'month', label: 'Month', type: 'string' },
      { id: 'planName', label: 'Plan', type: 'string' },
    ],
    measures: [
      { id: 'amount', label: 'Amount', type: 'number' },
    ],
  },
  {
    id: 'events',
    label: 'Lifecycle events',
    dateField: 'eventDate',
    dimensions: [
      { id: 'familyName', label: 'Family', type: 'string' },
      { id: 'eventType', label: 'Event type', type: 'string' },
      { id: 'year', label: 'Year', type: 'string' },
      { id: 'month', label: 'Month', type: 'string' },
    ],
    measures: [
      { id: 'amount', label: 'Amount', type: 'number' },
    ],
  },
  {
    id: 'members',
    label: 'Family members',
    dateField: 'birthDate',
    // `FamilyMember` has no `role` field — keep the existing dimensions
    // grounded in fields the schema actually exposes so the pivot
    // doesn't silently bucket everything as "(none)".
    dimensions: [
      { id: 'familyName', label: 'Family', type: 'string' },
      { id: 'gender', label: 'Gender', type: 'string' },
      { id: 'birthYear', label: 'Birth year', type: 'string' },
    ],
    measures: [],
  },
  {
    id: 'families',
    label: 'Families',
    dateField: 'weddingDate',
    dimensions: [
      { id: 'planName', label: 'Plan', type: 'string' },
      { id: 'weddingYear', label: 'Wedding year', type: 'string' },
      { id: 'emailOptOut', label: 'Email opt-out', type: 'string' },
    ],
    measures: [],
  },
]

export function getSourceDef(source: ReportSource): ReportSourceDef | null {
  return REPORT_SOURCES.find((s) => s.id === source) || null
}

interface FlatRow {
  // Loose shape — each source's loader populates whichever fields its
  // dimensions reference. Unknown keys yield "(none)" in the pivot.
  [key: string]: string | number | Date | null | undefined
}

/** Resolve family names (including soft-deleted) without populate `match`. */
async function familyInfoById(
  orgId: Types.ObjectId,
  familyIds: string[],
): Promise<Map<string, { name: string; paymentPlanId: string | null }>> {
  if (familyIds.length === 0) return new Map()
  const unique = [...new Set(familyIds.filter(Boolean))]
  const rows: any[] = []
  for (let i = 0; i < unique.length; i += UNBOUNDED_LIST_CAP) {
    const chunk = unique.slice(i, i + UNBOUNDED_LIST_CAP)
    const batch = await Family.find(
      { _id: { $in: chunk }, organizationId: orgId },
      null,
      { includeDeleted: true },
    )
      .select('_id name paymentPlanId')
      .lean<any[]>()
    rows.push(...batch)
  }
  return new Map(
    rows.map((f) => [
      String(f._id),
      {
        name: f.name || '(unnamed)',
        paymentPlanId: f.paymentPlanId ? String(f.paymentPlanId) : null,
      },
    ]),
  )
}

async function loadRows(
  source: ReportSource,
  orgId: Types.ObjectId,
  fromDate?: Date,
  toDate?: Date,
  timezone?: string | null,
): Promise<FlatRow[]> {
  if (source === 'payments') {
    const filter: any = { organizationId: orgId }
    if (fromDate || toDate) {
      filter.paymentDate = {}
      if (fromDate) filter.paymentDate.$gte = fromDate
      if (toDate) filter.paymentDate.$lte = toDate
    }
    const [rows, planDocs] = await Promise.all([
      collectCompoundCursorPages(
        (filter, limit) =>
          Payment.find(filter)
            .sort({ paymentDate: 1, _id: 1 })
            .limit(limit)
            .lean<any[]>(),
        filter,
        'paymentDate',
        1,
        (last) => ({
          v: last.paymentDate ? new Date(last.paymentDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
      ),
      loadAllByIdCursor<any>(
        (f, limit) =>
          PaymentPlan.find(f).select('_id name').sort({ _id: 1 }).limit(limit).lean<any[]>(),
        { organizationId: orgId },
      ),
    ])
    const planNameById = new Map(
      planDocs.map((pl) => [String(pl._id), pl.name || '(unnamed)']),
    )
    const familyById = await familyInfoById(
      orgId,
      rows.map((p) => (p.familyId ? String(p.familyId) : '')).filter(Boolean),
    )
    return rows.map((p) => {
      const date = p.paymentDate ? new Date(p.paymentDate) : null
      const fam = p.familyId ? familyById.get(String(p.familyId)) : undefined
      const planId = fam?.paymentPlanId ?? null
      return {
        amount: netPaymentAmount(p),
        familyName: fam?.name || '(no family)',
        type: p.type || '(unknown)',
        method: p.paymentMethod || '(unknown)',
        year: date ? String(getYearInTimeZone(timezone, date)) : '(no date)',
        month: date ? yearMonthInTimeZone(date, timezone) : '(no date)',
        planName: planId ? planNameById.get(planId) ?? '(unknown plan)' : '(none)',
      }
    })
  }

  if (source === 'events') {
    const filter: any = { organizationId: orgId }
    if (fromDate || toDate) {
      filter.eventDate = {}
      if (fromDate) filter.eventDate.$gte = fromDate
      if (toDate) filter.eventDate.$lte = toDate
    }
    const rows = await collectCompoundCursorPages(
      (filter, limit) =>
        LifecycleEventPayment.find(filter)
          .sort({ eventDate: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      filter,
      'eventDate',
      1,
      (last) => ({
        v: last.eventDate ? new Date(last.eventDate as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )
    const familyById = await familyInfoById(
      orgId,
      rows.map((e) => (e.familyId ? String(e.familyId) : '')).filter(Boolean),
    )
    return rows.map((e) => {
      const date = e.eventDate ? new Date(e.eventDate) : null
      return {
        amount: Number(e.amount || 0),
        familyName: familyById.get(String(e.familyId))?.name || '(no family)',
        eventType: e.eventType || '(unknown)',
        year: date ? String(getYearInTimeZone(timezone, date)) : '(no date)',
        month: date ? yearMonthInTimeZone(date, timezone) : '(no date)',
      }
    })
  }

  if (source === 'members') {
    const filter: any = {
      organizationId: orgId,
      convertedToFamily: { $ne: true },
    }
    if (fromDate || toDate) {
      filter.birthDate = {}
      if (fromDate) filter.birthDate.$gte = fromDate
      if (toDate) filter.birthDate.$lte = toDate
    }
    const rows: any[] = []
    for await (const batch of familyMemberBatches(String(orgId), filter)) {
      rows.push(...batch)
    }
    const familyById = await familyInfoById(
      orgId,
      rows.map((m) => (m.familyId ? String(m.familyId) : '')).filter(Boolean),
    )
    return rows.map((m) => {
      const bd = m.birthDate ? new Date(m.birthDate) : null
      return {
        familyName: familyById.get(String(m.familyId))?.name || '(no family)',
        gender: m.gender || '(unspecified)',
        birthYear: bd ? String(bd.getFullYear()) : '(unknown)',
      }
    })
  }

  // source === 'families'
  const filter: any = { organizationId: orgId }
  if (fromDate || toDate) {
    filter.weddingDate = {}
    if (fromDate) filter.weddingDate.$gte = fromDate
    if (toDate) filter.weddingDate.$lte = toDate
  }
  const [rows, planDocs] = await Promise.all([
    collectCompoundCursorPages(
      (filter, limit) =>
        Family.find(filter).sort({ name: 1, _id: 1 }).limit(limit).lean<any[]>(),
      filter,
      'name',
      1,
      (last) => ({
        v: typeof last.name === 'string' ? last.name : null,
        id: String(last._id),
      }),
    ),
    loadAllByIdCursor<any>(
      (f, limit) =>
        PaymentPlan.find(f).select('_id name').sort({ _id: 1 }).limit(limit).lean<any[]>(),
      { organizationId: orgId },
    ),
  ])
  const planNameById = new Map(
    planDocs.map((pl) => [String(pl._id), pl.name || '(unnamed)']),
  )
  return rows.map((f) => {
    const wd = f.weddingDate ? new Date(f.weddingDate) : null
    const planId = f.paymentPlanId ? String(f.paymentPlanId) : null
    return {
      planName: planId ? planNameById.get(planId) ?? '(unknown plan)' : '(none)',
      weddingYear: wd ? String(wd.getFullYear()) : '(unknown)',
      emailOptOut: f.emailOptOut ? 'opted out' : 'subscribed',
    }
  })
}

export interface ReportResult {
  rowLabels: string[]
  colLabels: string[]
  /** values[rowLabel]?.[colLabel] === pivoted measure */
  values: Record<string, Record<string, number>>
  totals: {
    rows: Record<string, number>
    cols: Record<string, number>
    grand: number
  }
  rowCount: number
}

/**
 * Run a pivot. Always returns an object the UI can render — never
 * throws on user-driven errors (bad dim names, missing measure, etc.)
 * because the UI should keep working as the user fiddles with the
 * config.
 */
export async function runReport(
  config: ReportConfig,
  organizationId: string,
): Promise<ReportResult> {
  const def = getSourceDef(config.source)
  if (!def) {
    return emptyResult()
  }

  const orgId = new Types.ObjectId(organizationId)
  let fromDate: Date | undefined
  let toDate: Date | undefined
  if (config.fromDate) {
    fromDate = new Date(config.fromDate)
    if (Number.isNaN(fromDate.getTime())) fromDate = undefined
  }
  if (config.toDate) {
    toDate = new Date(config.toDate)
    if (Number.isNaN(toDate.getTime())) toDate = undefined
  }
  if (fromDate && toDate) {
    const rangeErr = validateDateRange(fromDate, toDate)
    if (rangeErr) {
      return emptyResult()
    }
  }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(config.toDate || '')) {
    toDate.setUTCHours(23, 59, 59, 999)
  }

  const org = await Organization.findById(organizationId).select('timezone').lean<{ timezone?: string | null }>()
  const rows = await loadRows(config.source, orgId, fromDate, toDate, org?.timezone)

  const aggregate: Aggregate = config.aggregate || 'count'
  const measureId = config.measure || ''
  const rowDim = config.rowDim || ''
  const colDim = config.colDim || ''

  // We accumulate { sum, count, min, max } per (row, col) so any
  // aggregate can be derived in a single pass.
  type Bucket = { sum: number; count: number; min: number; max: number }
  const buckets: Record<string, Record<string, Bucket>> = {}
  const rowSet = new Set<string>()
  const colSet = new Set<string>()

  for (const r of rows) {
    const rowKey = rowDim ? coerceKey(r[rowDim]) : '(all)'
    const colKey = colDim ? coerceKey(r[colDim]) : 'value'

    let measureValue = 1
    if (aggregate !== 'count') {
      const raw = measureId ? r[measureId] : null
      const num = typeof raw === 'number' ? raw : Number(raw || 0)
      if (!Number.isFinite(num)) continue
      measureValue = num
    }

    rowSet.add(rowKey)
    colSet.add(colKey)
    const rowBucket = (buckets[rowKey] ||= {})
    const cell = (rowBucket[colKey] ||= {
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    })
    cell.sum += measureValue
    cell.count += 1
    if (measureValue < cell.min) cell.min = measureValue
    if (measureValue > cell.max) cell.max = measureValue
  }

  const reduce = (b: Bucket): number => {
    switch (aggregate) {
      case 'count':
        return b.count
      case 'sum':
        return b.sum
      case 'avg':
        return b.count ? b.sum / b.count : 0
      case 'min':
        return b.min === Infinity ? 0 : b.min
      case 'max':
        return b.max === -Infinity ? 0 : b.max
      default:
        return b.count
    }
  }

  const rowLabels = Array.from(rowSet).sort()
  const colLabels = Array.from(colSet).sort()
  const values: Record<string, Record<string, number>> = {}
  const rowTotals: Record<string, number> = {}
  const colTotals: Record<string, number> = {}
  let grand = 0

  for (const rl of rowLabels) {
    values[rl] = {}
    let rowSum = 0
    for (const cl of colLabels) {
      const b = buckets[rl]?.[cl]
      const v = b ? reduce(b) : 0
      values[rl][cl] = v
      // Totals only meaningful for sum/count — for avg/min/max they're
      // a "total of the cells" which the UI will label accordingly.
      rowSum += v
      colTotals[cl] = (colTotals[cl] || 0) + v
    }
    rowTotals[rl] = rowSum
    grand += rowSum
  }

  return {
    rowLabels,
    colLabels,
    values,
    totals: { rows: rowTotals, cols: colTotals, grand },
    rowCount: rows.length,
  }
}

function coerceKey(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(none)'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

function emptyResult(): ReportResult {
  return {
    rowLabels: [],
    colLabels: [],
    values: {},
    totals: { rows: {}, cols: {}, grand: 0 },
    rowCount: 0,
  }
}
