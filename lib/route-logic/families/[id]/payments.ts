import { Types } from 'mongoose'
import { Payment, Organization, Family, FamilyMember } from '@/lib/models'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { z } from 'zod'
import { isoDate, moneyAmount, objectId, optionalString, yearParam } from '@/lib/schemas'
import { getYearInTimeZone } from '@/lib/date-utils'
import {
  PAYMENT_PUBLIC_SELECT,
  serializePaymentPublic,
  serializePaymentsPublic,
} from '@/lib/payments/select'
import { checkRateLimit } from '@/lib/rate-limit'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'
import { familyLedgerListQuery, listFamilyLedger } from '@/lib/family-ledger-list'

const LEDGER_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
}

// GET /api/families/[id]/payments — list payments for one family.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  query: familyLedgerListQuery,
  name: 'GET /api/families/[id]/payments',
  fn: async ({ params, ctx, request, query }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-payments-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }
    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    const baseFilter = { familyId: id, organizationId: ctx!.organizationId }
    const loadPage = (filter: Record<string, unknown>, limit: number) =>
      Payment.find(filter)
        .select(PAYMENT_PUBLIC_SELECT)
        .sort({ paymentDate: -1, _id: -1 })
        .limit(limit)
        .lean()

    const effectiveQuery = {
      limit: query.limit ?? 0,
      cursor: query.cursor,
    }

    try {
      const data = await listFamilyLedger(
        baseFilter,
        loadPage,
        'paymentDate',
        -1,
        (last) => ({
          v: last.paymentDate ? new Date(last.paymentDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
        effectiveQuery,
      )
      return { data: serializePaymentsPublic(data as any[]), headers: LEDGER_CACHE_HEADERS }
    } catch (err) {
      if (err instanceof Error && err.message === 'Invalid cursor') {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      throw err
    }
  },
})

const createBody = z.object({
  amount: moneyAmount.gt(0, 'Amount must be greater than 0'),
  paymentDate: isoDate,
  year: yearParam,
  type: optionalString(60),
  paymentMethod: z.enum(['cash', 'credit_card', 'check', 'quick_pay']).optional(),
  ccInfo: z
    .object({
      last4: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
      cardType: optionalString(40),
      expiryMonth: optionalString(2),
      expiryYear: optionalString(4),
      nameOnCard: optionalString(120),
    })
    .optional(),
  checkInfo: z
    .object({
      checkNumber: optionalString(40),
      bankName: optionalString(120),
      routingNumber: optionalString(40),
    })
    .optional(),
  notes: optionalString(2000),
  memberId: objectId.optional(),
})

// POST /api/families/[id]/payments — record a payment for one family.
// Admin-only: this writes money into the ledger. Members can view
// payments via GET but cannot create them.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: createBody,
  name: 'POST /api/families/[id]/payments',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-payment-create',
      { limit: 60, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    // Tenant guard: a 24-char ObjectId from another org would still
    // create a Payment row scoped to OUR org with an invalid familyId.
    // Verify the family belongs here before writing.
    const fam = await Family.findOne({
      _id: id,
      organizationId: ctx!.organizationId,
    }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    // memberId is optional, but when supplied it MUST point at a member
    // of this family and this org — otherwise a caller could attribute
    // payments to a member from a completely different family / tenant.
    if (body.memberId) {
      const mem = await FamilyMember.findOne({
        _id: body.memberId,
        familyId: id,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!mem) return { status: 404, data: { error: 'Member not found in family' } }
    }

    const method = body.paymentMethod || 'cash'

    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    const derivedYear = getYearInTimeZone(org?.timezone, body.paymentDate)
    if (body.year !== derivedYear) {
      return {
        status: 400,
        data: {
          error: `Year ${body.year} does not match payment date year ${derivedYear} in org timezone`,
        },
      }
    }

    const doc: Record<string, unknown> = {
      organizationId: ctx!.organizationId,
      familyId: id,
      amount: body.amount,
      paymentDate: body.paymentDate,
      year: body.year,
      type: body.type || 'membership',
      paymentMethod: method,
      notes: body.notes,
    }
    if (body.memberId) doc.memberId = body.memberId
    if (method === 'credit_card' && body.ccInfo) doc.ccInfo = body.ccInfo
    if (method === 'check' && body.checkInfo) doc.checkInfo = body.checkInfo

    const payment = await Payment.create(doc)

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'payment.create',
      resourceType: 'Payment',
      resourceId: payment._id,
      metadata: {
        familyId: id,
        amount: body.amount,
        method,
        type: doc.type,
        year: body.year,
      },
      request,
    })

    scheduleYearlyCalculationRefresh(body.year, ctx!.organizationId)

    return {
      status: 201,
      data: serializePaymentPublic(
        (await Payment.findOne({
          _id: payment._id,
          organizationId: ctx!.organizationId,
        })
          .select(PAYMENT_PUBLIC_SELECT)
          .lean())!,
      ),
    }
  },
})
