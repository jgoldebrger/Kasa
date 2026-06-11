/**
 * POST /api/families/bulk
 *
 * Bulk action over many family rows. Required because doing N HTTP
 * round-trips from the client is brittle and slow for large orgs.
 *
 * Body shape (discriminated union):
 *   { action: 'delete',          ids: ObjectId[] }
 *   { action: 'setPaymentPlan',  ids: ObjectId[], paymentPlanId: ObjectId | null }
 *   { action: 'setEmailOptOut',  ids: ObjectId[], emailOptOut: boolean }
 *
 * Auth: any org member with `admin+` role (delete is destructive and
 * setting plan/email-opt-out can quietly change billing behavior).
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Family, PaymentPlan } from '@/lib/models'
import { audit } from '@/lib/audit'
import { objectId } from '@/lib/schemas/common'
import { softDeleteFamilyCascade } from '@/lib/recycle-bin'
import { checkRateLimit } from '@/lib/rate-limit'

const idsField = z.array(objectId).min(1, 'Select at least one family').max(500)

const body = z.union([
  z.object({ action: z.literal('delete'), ids: idsField }),
  z.object({
    action: z.literal('setPaymentPlan'),
    ids: idsField,
    paymentPlanId: objectId.nullable(),
  }),
  z.object({
    action: z.literal('setEmailOptOut'),
    ids: idsField,
    emailOptOut: z.boolean(),
  }),
])

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body,
  name: 'POST /api/families/bulk',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(request, 'families-bulk', {
      limit: 30,
      windowMs: 60_000,
    }, ctx!.organizationId)
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = new Types.ObjectId(ctx!.organizationId)
    const idObjs = body.ids.map((id) => new Types.ObjectId(id))
    const baseFilter = { _id: { $in: idObjs }, organizationId: orgId }

    if (body.action === 'delete') {
      // CRITICAL: the previous implementation called `Family.deleteMany`
      // assuming the soft-delete plugin would convert it into an
      // updateMany. It does NOT — the plugin only pre-filters
      // already-deleted rows. The result was that bulk-delete from the
      // UI **hard-deleted** families (no recycle bin, no restore) AND
      // orphaned every member / payment / statement / withdrawal /
      // cycle-charge those families owned.
      //
      // Route per family through `softDeleteFamilyCascade` so the
      // behavior matches `DELETE /api/families/[id]` — moves to the
      // recycle bin and cascades to every child row.
      let modified = 0
      const failed: string[] = []
      for (const id of body.ids) {
        try {
          const res = await softDeleteFamilyCascade(id, ctx!, { request })
          if (res) modified += 1
        } catch (err) {
          failed.push(id)
          // Continue with the remaining ids — partial success is better
          // than failing the whole batch.
          // eslint-disable-next-line no-console
          console.error('[families.bulk] cascade failed for', id, err)
        }
      }
      await audit({
        organizationId: ctx!.organizationId,
        userId: session!.user.id,
        action: 'family.bulk_delete',
        resourceType: 'Family',
        metadata: {
          ids: body.ids,
          count: modified,
          failed: failed.length > 0 ? failed : undefined,
        },
        request,
      })
      return { data: { ok: true, modified, failed: failed.length } }
    }

    if (body.action === 'setPaymentPlan') {
      if (body.paymentPlanId) {
        // Verify the plan belongs to this org before assigning — guards
        // against an attacker submitting another org's plan id.
        const plan = await PaymentPlan.findOne({
          _id: new Types.ObjectId(body.paymentPlanId),
          organizationId: orgId,
        }).select('_id')
        if (!plan) {
          return { status: 404, data: { error: 'Payment plan not found in this org' } }
        }
      }
      const result = await Family.updateMany(baseFilter, {
        $set: { paymentPlanId: body.paymentPlanId },
      })
      await audit({
        organizationId: ctx!.organizationId,
        userId: session!.user.id,
        action: 'family.bulk_set_plan',
        resourceType: 'Family',
        metadata: {
          ids: body.ids,
          paymentPlanId: body.paymentPlanId,
          count: result.modifiedCount || 0,
        },
        request,
      })
      return { data: { ok: true, modified: result.modifiedCount || 0 } }
    }

    // action === 'setEmailOptOut'
    const result = await Family.updateMany(baseFilter, {
      $set: { emailOptOut: body.emailOptOut },
    })
    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'family.bulk_set_email_opt_out',
      resourceType: 'Family',
      metadata: {
        ids: body.ids,
        emailOptOut: body.emailOptOut,
        count: result.modifiedCount || 0,
      },
      request,
    })
    return { data: { ok: true, modified: result.modifiedCount || 0 } }
  },
})
