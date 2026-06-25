import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Family, Payment, Organization } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { hasMinRole } from '@/lib/auth-helpers'
import { PAYMENT_PUBLIC_SELECT, serializePaymentsPublic } from '@/lib/payments/select'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  getOrgStripeConnect,
  ORG_CONNECT_SELECT,
  type OrgStripeConnectFields,
} from '@/lib/stripe/client'

const MEMBER_PAYMENT_LIMIT = 10

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=15' }

/**
 * GET /api/families/[id]/member-financials
 * Read-only balance + recent payments for org members linked by email.
 */
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  name: 'GET /api/families/[id]/member-financials',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-financials',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyId = params.id as string
    if (!Types.ObjectId.isValid(familyId)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    const access = await checkMemberFamilyFinancialAccess(
      ctx!.organizationId,
      familyId,
      ctx!.userId,
      ctx!.role,
    )
    if (!access.allowed) {
      return { status: 403, data: { error: 'Financial access denied for this family' } }
    }

    const fam = await Family.findOne({ _id: familyId, organizationId: ctx!.organizationId })
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const [balance, payments, org] = await Promise.all([
      calculateFamilyBalance(familyId, ctx!.organizationId),
      Payment.find({ familyId, organizationId: ctx!.organizationId })
        .select(PAYMENT_PUBLIC_SELECT)
        .sort({ paymentDate: -1, _id: -1 })
        .limit(MEMBER_PAYMENT_LIMIT)
        .lean<any[]>(),
      Organization.findById(ctx!.organizationId)
        .select(ORG_CONNECT_SELECT)
        .lean<OrgStripeConnectFields>(),
    ])

    const connect = getOrgStripeConnect(org)
    const cardPaymentsEnabled = Boolean(connect)

    return {
      data: {
        linked: !hasMinRole(ctx!.role, 'admin'),
        balance,
        payments: serializePaymentsPublic(payments),
        cardPaymentsEnabled,
      },
      headers: CACHE_HEADERS,
    }
  },
})
