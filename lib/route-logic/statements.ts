import { Statement, Family, nextCounter } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { handler } from '@/lib/api/handler'
import { z } from 'zod'
import { objectId, paginationLimit, UNBOUNDED_LIST_CAP } from '@/lib/schemas'
import { statement as statementSchemas } from '@/lib/schemas'
import { loadStatementPeriod, statementSnapshotFromPeriod } from '@/lib/statements/period'
import { tolerantMsRange } from '@/lib/date-utils'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  compoundCursorFilter,
  decodeCompoundCursor,
  encodeCompoundCursor,
  collectCompoundCursorPages,
} from '@/lib/pagination'

const listQuery = z.object({
  familyId: objectId.optional(),
  limit: paginationLimit,
  cursor: z.string().min(1).max(400).optional(),
})

const generateBody = statementSchemas.statementGenerateBody

// GET /api/statements — list statements for the active org, optionally by family.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: listQuery,
  name: 'GET /api/statements',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'statements-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const filter: Record<string, unknown> = { organizationId: ctx!.organizationId }
    if (query.familyId) {
      const fam = await Family.findOne({
        _id: query.familyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!fam) return { status: 404, data: { error: 'Family not found' } }
      filter.familyId = query.familyId
    }
    if (query.cursor) {
      const c = decodeCompoundCursor(query.cursor)
      if (!c) {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      const cursorDate = c.v === null ? null : new Date(c.v as number)
      Object.assign(filter, compoundCursorFilter('date', cursorDate, c.id, -1))
    }

    // Bound the unbounded path. See `/api/payments` for the rationale.
    const clientLimit = query.limit ?? 0
    const effectiveLimit = clientLimit > 0 ? clientLimit : UNBOUNDED_LIST_CAP

    const loadStatementPage = async (pageFilter: Record<string, unknown>, limit: number) =>
      (await Statement.find(pageFilter)
        .select(
          '_id familyId memberId statementNumber date fromDate toDate ' +
            'openingBalance income withdrawals expenses cycleCharges closingBalance',
        )
        .sort({ date: -1, _id: -1 })
        .limit(limit).lean()) as any[]

    let nextCursor: string | null = null
    let data: any[]
    if (clientLimit > 0) {
      const rows = await loadStatementPage(filter, effectiveLimit + 1)
      data = rows
      if (rows.length > effectiveLimit) {
        data = rows.slice(0, effectiveLimit)
        const last = data[data.length - 1]
        if (last) {
          nextCursor = encodeCompoundCursor({
            v: last.date ? new Date(last.date).getTime() : null,
            id: String(last._id),
          })
        }
      }
    } else {
      data = await collectCompoundCursorPages(
        loadStatementPage,
        filter,
        'date',
        -1,
        (last) => ({
          v: last.date ? new Date(last.date as string | Date).getTime() : null,
          id: String(last._id),
        }),
      )
    }

    return { data: clientLimit > 0 ? { items: data, nextCursor } : data }
  },
})

// POST /api/statements — generate a fresh statement for one family over a range.
//
// admin+: mints a real Statement row (consuming the per-family
// counter), and the rendered PDF/email is the one families receive
// from the org. Every adjacent statement-mutation route (per-member
// generate, bulk send, monthly cron) requires admin already — this
// arbitrary-range generator was the holdover.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: generateBody,
  name: 'POST /api/statements',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'statements-generate',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { familyId, fromDate: from, toDate: to } = body

    const family = await Family.findOne({ _id: familyId, organizationId: ctx!.organizationId })
    if (!family) return { status: 404, data: { error: 'Family not found' } }

    const openingBalanceData = await calculateFamilyBalance(
      familyId,
      ctx!.organizationId,
      new Date(from.getTime() - 1),
    )
    const openingBalance = openingBalanceData.balance

    const [period, existing] = await Promise.all([
      loadStatementPeriod({
        organizationId: ctx!.organizationId,
        familyId,
        fromDate: from,
        toDate: to,
        openingBalance,
      }),
      Statement.findOne({
        organizationId: ctx!.organizationId,
        familyId,
        fromDate: tolerantMsRange(from),
        toDate: tolerantMsRange(to),
      }),
    ])

    // Idempotency guard: a double-clicked "Generate" should return the
    // same Statement, not duplicate ledger rows. Refresh the snapshot
    // from live ledger data so a re-generate after payments change
    // returns current totals, not a stale row.
    if (existing) {
      const refreshed = await Statement.findOneAndUpdate(
        { _id: existing._id, organizationId: ctx!.organizationId, familyId },
        { $set: statementSnapshotFromPeriod(openingBalance, period) },
        { new: true },
      )
      return { status: 200, data: refreshed ?? existing }
    }

    // Atomic per-family sequence. The previous `countDocuments + 1`
    // scheme raced under concurrent generation — two clicks for
    // different periods would both compute the same number.
    const seq = await nextCounter(`stmt:${ctx!.organizationId}:${familyId}`, async () =>
      Statement.countDocuments({ organizationId: ctx!.organizationId, familyId }),
    )
    const statementNumber = `STMT-${familyId.slice(-6)}-${seq}`

    try {
      const statement = await Statement.create({
        organizationId: ctx!.organizationId,
        familyId,
        statementNumber,
        date: new Date(),
        fromDate: from,
        toDate: to,
        ...statementSnapshotFromPeriod(openingBalance, period),
      })
      return { status: 201, data: statement }
    } catch (err: any) {
      if (err?.code === 11000) {
        const raced = await Statement.findOne({
          organizationId: ctx!.organizationId,
          familyId,
          fromDate: tolerantMsRange(from),
          toDate: tolerantMsRange(to),
        })
        if (raced) {
          const refreshed = await Statement.findOneAndUpdate(
            { _id: raced._id, organizationId: ctx!.organizationId, familyId },
            { $set: statementSnapshotFromPeriod(openingBalance, period) },
            { new: true },
          )
          return { status: 200, data: refreshed ?? raced }
        }
      }
      throw err
    }
  },
})
