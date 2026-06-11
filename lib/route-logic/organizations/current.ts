/**
 * GET /api/organizations/current
 *
 * Slim doc for the user's active org. Used by client-side context
 * providers (currency, locale, branding) that need to know a few fields
 * but not pull the whole organization document.
 *
 * Selected fields are intentionally narrow — keep it lean so the
 * provider's first paint isn't blocked on a large payload. Letterhead,
 * branding internals, automation flags, etc. each have their own
 * dedicated endpoints when a page actually needs them.
 */

import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { isSupportedCurrency } from '@/lib/currency'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  name: 'GET /api/organizations/current',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-current',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select(
        '_id name slug currency locale planTier subscriptionStatus trialEndsAt currentPeriodEnd stripeCustomerId',
      )
      .lean<{
        _id: any
        name?: string
        slug?: string
        currency?: string
        locale?: string
        planTier?: string | null
        subscriptionStatus?: string | null
        trialEndsAt?: Date | null
        currentPeriodEnd?: Date | null
        stripeCustomerId?: string | null
      }>()
    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    return {
      data: {
        id: org._id.toString(),
        name: org.name || '',
        slug: org.slug || '',
        currency: (org.currency || 'USD').toUpperCase(),
        locale: org.locale || 'en-US',
        planTier: org.planTier ?? null,
        subscriptionStatus: org.subscriptionStatus ?? null,
        trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
        stripeCustomerId: org.stripeCustomerId ?? null,
      },
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=600',
      },
    }
  },
})

const patchBody = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3)
    .refine(isSupportedCurrency, 'Unsupported currency')
    .optional(),
  // BCP 47 is hard to fully validate without ICU; accept a reasonable
  // pattern (letters / digits / hyphens, 2–32 chars) and let
  // `Intl.NumberFormat` reject anything pathological at render time.
  locale: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Invalid locale')
    .optional(),
  // Renaming the org happens elsewhere; intentionally not allowed here.
})

export const PATCH = handler({
  auth: 'org',
  minRole: 'admin',
  body: patchBody,
  name: 'PATCH /api/organizations/current',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-current-patch',
      { limit: 30, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const update: Record<string, unknown> = {}
    if (body.currency) update.currency = body.currency
    if (body.locale) update.locale = body.locale

    if (Object.keys(update).length === 0) {
      return { data: { ok: true, noop: true } }
    }

    const updated = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: update },
      { new: true },
    )
      .select('currency locale')
      .lean<{ currency?: string; locale?: string }>()
    if (!updated) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'org.settings.update',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: { fields: Object.keys(update) },
      request,
    })

    return {
      data: {
        currency: (updated.currency || 'USD').toUpperCase(),
        locale: updated.locale || 'en-US',
      },
    }
  },
})
