import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { SavedPaymentMethod, Family, Organization } from '@/lib/models'
import {
  connectRequestOptions,
  getOrgStripeConnect,
  getPlatformStripe,
  isStripeConnectEnabled,
  ORG_CONNECT_SELECT,
  type OrgStripeConnectFields,
} from '@/lib/stripe/client'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { payment as paymentSchemas } from '@/lib/schemas'
import { requireFamilyPaymentAccess } from '@/lib/member-family-access.server'

function publicSavedPaymentMethod(
  doc: { toObject?: () => Record<string, unknown> } & Record<string, unknown>,
) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  delete obj.stripePaymentMethodId
  delete obj.organizationId
  return obj
}

// GET - Get all saved payment methods for a family
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  name: 'GET /api/families/[id]/saved-payment-methods',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-saved-payment-methods',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const paymentAccess = await requireFamilyPaymentAccess(
      ctx!.organizationId,
      id,
      ctx!.userId,
      ctx!.role,
    )
    if (!paymentAccess.ok) {
      return { status: paymentAccess.status, data: { error: paymentAccess.error } }
    }

    const paymentMethods = await loadAllByIdCursor(
      (filter, limit) =>
        SavedPaymentMethod.find(filter)
          .select('-stripePaymentMethodId -organizationId')
          .sort({ isDefault: -1, createdAt: -1, _id: -1 })
          .limit(limit),
      {
        familyId: id,
        isActive: true,
        organizationId: ctx!.organizationId,
      },
    )

    return { data: paymentMethods }
  },
})

// POST - Save a new payment method
export const POST = handler({
  auth: 'org',
  idParams: ['id'],
  body: paymentSchemas.savePaymentMethodBody,
  name: 'POST /api/families/[id]/saved-payment-methods',
  fn: async ({ params, ctx, body, request }) => {
    const id = params.id as string
    const { paymentMethodId, setAsDefault, paymentIntentId } = body

    const rateVerdict = await checkRateLimit(
      request,
      'save-payment-method',
      { limit: 20, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const paymentAccess = await requireFamilyPaymentAccess(
      ctx!.organizationId,
      id,
      ctx!.userId,
      ctx!.role,
    )
    if (!paymentAccess.ok) {
      return { status: paymentAccess.status, data: { error: paymentAccess.error } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select(ORG_CONNECT_SELECT)
      .lean<OrgStripeConnectFields>()
    const connect = getOrgStripeConnect(org)

    const stripe = getPlatformStripe()
    if (!stripe) {
      return { status: 500, data: { error: 'Stripe is not configured' } }
    }

    try {
      const intent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        connectRequestOptions(connect),
      )
      if (intent.status !== 'succeeded') {
        return { status: 400, data: { error: 'PaymentIntent has not succeeded' } }
      }
      const piPM =
        typeof intent.payment_method === 'string'
          ? intent.payment_method
          : intent.payment_method?.id
      if (piPM !== paymentMethodId) {
        return {
          status: 403,
          data: { error: 'PaymentMethod does not match the supplied PaymentIntent' },
        }
      }
      const piOrg = intent.metadata?.organizationId
      const piFam = intent.metadata?.familyId
      if (!piOrg || piOrg !== String(ctx!.organizationId)) {
        return {
          status: 403,
          data: { error: 'PaymentIntent does not belong to this organization' },
        }
      }
      if (!piFam || piFam !== String(id)) {
        return { status: 403, data: { error: 'PaymentIntent does not belong to this family' } }
      }
    } catch (err: any) {
      console.error('[saved-payment-methods] PI verification failed:', err?.message)
      return { status: 400, data: { error: 'Could not verify PaymentIntent' } }
    }
    const paymentMethod = await stripe.paymentMethods.retrieve(
      paymentMethodId,
      connectRequestOptions(connect),
    )

    if (!paymentMethod.card) {
      return { status: 400, data: { error: 'Invalid payment method' } }
    }

    if (setAsDefault) {
      await SavedPaymentMethod.updateMany(
        { familyId: id, organizationId: ctx!.organizationId },
        { isDefault: false },
      )
    }

    const existing = await SavedPaymentMethod.findOne({
      familyId: id,
      stripePaymentMethodId: paymentMethodId,
      organizationId: ctx!.organizationId,
    })

    if (existing) {
      existing.isDefault = setAsDefault || false
      existing.isActive = true
      if (isStripeConnectEnabled()) {
        existing.legacyPlatformAccount = false
      }
      await existing.save()
      return { data: publicSavedPaymentMethod(existing) }
    }

    const savedPaymentMethod = await SavedPaymentMethod.create({
      familyId: id,
      stripePaymentMethodId: paymentMethodId,
      last4: paymentMethod.card.last4,
      cardType: paymentMethod.card.brand,
      expiryMonth: paymentMethod.card.exp_month,
      expiryYear: paymentMethod.card.exp_year,
      nameOnCard: paymentMethod.billing_details?.name || undefined,
      isDefault: setAsDefault || false,
      isActive: true,
      organizationId: ctx!.organizationId,
      ...(isStripeConnectEnabled() ? { legacyPlatformAccount: false } : {}),
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'saved_payment_method.create',
      resourceType: 'SavedPaymentMethod',
      resourceId: savedPaymentMethod._id,
      metadata: {
        familyId: id,
        last4: paymentMethod.card.last4,
        cardType: paymentMethod.card.brand,
      },
      request,
    })

    return { status: 201, data: publicSavedPaymentMethod(savedPaymentMethod) }
  },
})

// DELETE - Remove a saved payment method
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/families/[id]/saved-payment-methods',
  fn: async ({ params, ctx, request }) => {
    const id = params.id as string

    const rateVerdict = await checkRateLimit(
      request,
      'delete-payment-method',
      { limit: 30, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const paymentMethodId = request.nextUrl.searchParams.get('paymentMethodId')

    if (!paymentMethodId) {
      return { status: 400, data: { error: 'Payment method ID is required' } }
    }
    if (!Types.ObjectId.isValid(paymentMethodId)) {
      return { status: 400, data: { error: 'Invalid payment method ID' } }
    }

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const updated = await SavedPaymentMethod.findOneAndUpdate(
      {
        _id: paymentMethodId,
        familyId: id,
        organizationId: ctx!.organizationId,
      },
      { isActive: false },
      { new: true },
    )
    if (!updated) {
      return { status: 404, data: { error: 'Payment method not found' } }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'saved_payment_method.delete',
      resourceType: 'SavedPaymentMethod',
      resourceId: paymentMethodId as any,
      metadata: { familyId: id },
      request,
    })

    return { data: { success: true } }
  },
})
