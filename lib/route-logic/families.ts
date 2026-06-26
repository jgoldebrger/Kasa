import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { Family, FamilyMember, PaymentPlan } from '@/lib/models'
import { audit } from '@/lib/audit'
import { emailFormatInvalidFlag } from '@/lib/mail/validate-email'
import {
  compoundCursorFilter,
  decodeCompoundCursor,
  encodeCompoundCursor,
  collectCompoundCursorPages,
} from '@/lib/pagination'
import { FAMILY_BALANCES_IDS_CAP, objectId, UNBOUNDED_LIST_CAP, positiveInt } from '@/lib/schemas'
import { family as familySchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { enforceFamilyCapGate } from '@/lib/billing/feature-gate'

// GET - Get all families (optionally paginated via ?limit=&cursor=)
// Rate limit exempt: org-scoped read — see lib/rate-limit.ts (ORG_SCOPED_READ_EXEMPT_SCOPES).
export const GET = handler({
  auth: 'org',
  name: 'GET /api/families',
  fn: async ({ ctx, request }) => {
    const { searchParams } = new URL(request.url)

    if (searchParams.get('view') === 'names') {
      const rawIds = (searchParams.get('familyIds') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (rawIds.length > FAMILY_BALANCES_IDS_CAP) {
        return { status: 400, data: { error: 'Too many familyIds' } }
      }
      const validIds = rawIds.filter((id) => objectId.safeParse(id).success)
      if (validIds.length === 0) {
        return {
          data: { names: {} },
          headers: { 'Cache-Control': 'private, max-age=60' },
        }
      }
      const families = await Family.find({
        _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        organizationId: ctx!.organizationId,
      })
        .select('_id name')
        .lean<Array<{ _id: unknown; name?: string }>>()
      const names: Record<string, string> = {}
      for (const f of families) {
        names[String(f._id)] = typeof f.name === 'string' ? f.name : ''
      }
      return {
        data: { names },
        headers: { 'Cache-Control': 'private, max-age=60' },
      }
    }

    const limitParam = searchParams.get('limit')
    const cursorParam = searchParams.get('cursor')
    // `clientLimit` is what the caller asked for (0 = legacy "all rows").
    // `effectiveLimit` is what we actually run against Mongo — bounded
    // even in the legacy path so the request can't materialise the
    // entire org's family list.
    let clientLimit = 0
    if (limitParam) {
      const parsed = positiveInt.max(500).safeParse(limitParam)
      if (parsed.success) clientLimit = parsed.data
    }
    const effectiveLimit = clientLimit > 0 ? clientLimit : UNBOUNDED_LIST_CAP

    const baseFilter: Record<string, unknown> = { organizationId: ctx!.organizationId }
    if (cursorParam) {
      // Compound cursor on (name asc, _id asc). The previous version
      // only encoded `_id` which silently skipped rows whenever two
      // families shared a name. The new encoding pairs the trailing
      // row's name + _id so the resume condition matches the sort.
      const c = decodeCompoundCursor(cursorParam)
      if (!c) {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      Object.assign(baseFilter, compoundCursorFilter('name', c.v as string | null, c.id, 1))
    }

    const familySelect = '-deletedAt -deletedBy -deletedKind -updatedAt -__v'
    const loadFamilyPage = async (filter: Record<string, unknown>, limit: number) =>
      Family.find(filter).select(familySelect).sort({ name: 1, _id: 1 }).limit(limit).lean<any[]>()

    let nextCursor: string | null = null
    let families: any[]
    if (clientLimit > 0) {
      const familiesAll = await loadFamilyPage(baseFilter, effectiveLimit + 1)
      families = familiesAll
      if (familiesAll.length > effectiveLimit) {
        families = familiesAll.slice(0, effectiveLimit)
        const last = families[families.length - 1]
        if (last) {
          nextCursor = encodeCompoundCursor({
            v: typeof last.name === 'string' ? last.name : null,
            id: String(last._id),
          })
        }
      }
    } else {
      families = await collectCompoundCursorPages(
        loadFamilyPage,
        baseFilter,
        'name',
        1,
        (last) => ({
          v: typeof last.name === 'string' ? last.name : null,
          id: String(last._id),
        }),
      )
    }

    if (families.length === 0) {
      return { data: clientLimit > 0 ? { items: [], nextCursor: null } : [] }
    }

    // 2) Single grouped query for member counts. Avoids the previous N+1
    //    pattern (1 + 1-per-family). On an org with N families the cost
    //    goes from ~N+1 round trips to exactly 2.
    //
    // CRITICAL: `Model.aggregate()` does NOT cast pipeline values the way
    // `find()` does. `ctx.organizationId` is a `string`, but the schema
    // stores `organizationId` as an `ObjectId` — leaving the raw string in
    // the `$match` means MongoDB sees `string === ObjectId` which is
    // always false, the aggregation returns an empty array, and every
    // family in the list silently shows `memberCount: 0`. We must cast
    // explicitly to `Types.ObjectId`. (familyIds came from `.find()` and
    // are already real ObjectIds, so the `$in` half is fine.)
    const familyIds = families.map((f) => f._id)
    const memberCounts = await FamilyMember.aggregate([
      {
        $match: {
          familyId: { $in: familyIds },
          organizationId: new Types.ObjectId(String(ctx!.organizationId)),
          deletedAt: null,
          convertedToFamily: { $ne: true },
        },
      },
      { $group: { _id: '$familyId', count: { $sum: 1 } } },
    ])
    const countByFamily = new Map<string, number>()
    for (const row of memberCounts) {
      countByFamily.set(String(row._id), row.count)
    }

    const isAdmin = hasMinRole(ctx!.role, 'admin')

    // 3) Stringify ObjectIds and attach memberCount in-memory. No more
    //    per-family writes / paymentPlanId backfill on the read path —
    //    that's a migration concern, not a request-time concern.
    const out = families.map((familyObj) => {
      const row: Record<string, unknown> = {
        ...familyObj,
        _id: familyObj._id?.toString() || familyObj._id,
        paymentPlanId: familyObj.paymentPlanId?.toString() || familyObj.paymentPlanId,
        parentFamilyId: familyObj.parentFamilyId?.toString() || familyObj.parentFamilyId,
        memberCount: countByFamily.get(String(familyObj._id)) || 0,
      }
      if (!isAdmin) {
        delete row.openBalance
        delete row.currentPayment
        delete row.currentPlan
        delete row.paymentPlanId
      }
      return row
    })

    // Preserve the legacy array shape when no pagination is requested;
    // wrap in an envelope when the client opts in via `?limit=`.
    const body = clientLimit > 0 ? { items: out, nextCursor } : out
    return {
      data: body,
      headers: { 'Cache-Control': 'private, max-age=15' },
    }
  },
})

// POST - Create a new family
//
// admin+: families enter the financial system (balance, statements, tax
// receipts, recurring payments, dues). The default `requireOrg` minRole
// of `member` previously let any logged-in org member add billable
// families. Every other family-mutation route (DELETE, bulk, payments,
// withdrawals, lifecycle events, charge-saved-card) already enforced
// admin+; this route was the only mutation hole.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: familySchemas.familyCreateBody,
  name: 'POST /api/families',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'families-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyGate = await enforceFamilyCapGate(ctx!.organizationId)
    if (!familyGate.ok) {
      return { status: familyGate.status, data: { error: familyGate.error } }
    }

    const {
      name,
      hebrewName,
      weddingDate: weddingDateObj,
      husbandFirstName,
      husbandHebrewName,
      husbandFatherHebrewName,
      wifeFirstName,
      wifeHebrewName,
      wifeFatherHebrewName,
      husbandCellPhone,
      wifeCellPhone,
      address,
      street,
      phone,
      email,
      city,
      state,
      zip,
      paymentPlanId,
      currentPayment,
      openBalance,
      emailOptOut,
    } = body

    const weddingYear = weddingDateObj.getFullYear()
    if (weddingYear < 1900 || weddingYear > 2200) {
      return {
        status: 400,
        data: { error: 'Wedding date out of supported range (1900–2200)' },
      }
    }

    // Find payment plan by ID only — must belong to the user's org
    let paymentPlan = null
    try {
      paymentPlan = await PaymentPlan.findOne({
        _id: paymentPlanId,
        organizationId: ctx!.organizationId,
      })
      if (!paymentPlan) {
        return {
          status: 400,
          data: { error: `Payment plan with ID ${paymentPlanId} not found` },
        }
      }
    } catch (error) {
      console.error('Error finding payment plan:', error)
      return {
        status: 500,
        data: {
          error: 'Failed to find payment plan',
          ...(process.env.NODE_ENV !== 'production' && {
            details: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      }
    }

    const family = await Family.create({
      organizationId: ctx!.organizationId,
      name,
      hebrewName: hebrewName || undefined,
      weddingDate: weddingDateObj,
      husbandFirstName: husbandFirstName || undefined,
      husbandHebrewName: husbandHebrewName || undefined,
      husbandFatherHebrewName: husbandFatherHebrewName || undefined,
      wifeFirstName: wifeFirstName || undefined,
      wifeHebrewName: wifeHebrewName || undefined,
      wifeFatherHebrewName: wifeFatherHebrewName || undefined,
      husbandCellPhone: husbandCellPhone || undefined,
      wifeCellPhone: wifeCellPhone || undefined,
      address: address || undefined,
      street: street || undefined,
      phone: phone || undefined,
      email: email || undefined,
      city: city || undefined,
      state: state || undefined,
      zip: zip || undefined,
      paymentPlanId: paymentPlanId,
      currentPlan: paymentPlan.planNumber,
      currentPayment:
        currentPayment !== undefined &&
        currentPayment !== null &&
        Number.isFinite(Number(currentPayment))
          ? Number(currentPayment)
          : 0,
      openBalance:
        openBalance !== undefined && openBalance !== null && Number.isFinite(Number(openBalance))
          ? Number(openBalance)
          : 0,
      emailOptOut: emailOptOut === true,
      emailFormatInvalid: emailFormatInvalidFlag(email),
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'family.create',
      resourceType: 'Family',
      resourceId: family._id,
      metadata: { name: family.name, paymentPlanId: String(paymentPlanId) },
      request,
    })

    return { status: 201, data: family }
  },
})
