/**
 * GET   /api/organizations/branding — return the active org's logo + accent.
 * PUT   /api/organizations/branding — owner/admin set logo and/or accent.
 * DELETE /api/organizations/branding — owner/admin clear the custom logo.
 *
 * The logo is stored as a base64 data URL directly on the Organization doc
 * (capped at ~200KB after server-side resize via lib/branding.ts).
 */

import { z } from 'zod'
import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { processLogoDataUrl, validateAccentColor } from '@/lib/branding'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const putBody = z.object({
  // Either a full data URL (replace) or null/undefined (no change).
  logoDataUrl: z.string().min(0).max(4_000_000).nullable().optional(),
  // Accent: hex string, or null to clear, or undefined to leave unchanged.
  accentColor: z.string().min(0).max(20).nullable().optional(),
})

export const GET = handler({
  auth: 'org',
  name: 'GET /api/organizations/branding',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-branding-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('name slug branding')
      .lean<any>()
    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    // Build a versioned URL for the binary logo endpoint so the browser can
    // cache the image forever (cache-buster updates when logoUpdatedAt does).
    const logoUpdatedAtMs = org.branding?.logoUpdatedAt
      ? new Date(org.branding.logoUpdatedAt).getTime()
      : null
    const logoUrl = org.branding?.logoDataUrl
      ? `/api/organizations/branding/logo?v=${logoUpdatedAtMs ?? 0}`
      : null

    const res = NextResponse.json({
      name: org.name,
      slug: org.slug,
      branding: {
        logoDataUrl: org.branding?.logoDataUrl || null,
        logoUrl,
        logoUpdatedAt: org.branding?.logoUpdatedAt || null,
        accentColor: org.branding?.accentColor || null,
      },
    })
    // Cache the response privately so quick re-renders don't re-fetch.
    res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=600')
    return res
  },
})

export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  body: putBody,
  name: 'PUT /api/organizations/branding',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-branding-update',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const update: Record<string, unknown> = {}
    const logoTouched = body.logoDataUrl !== undefined
    const accentTouched = body.accentColor !== undefined

    if (!logoTouched && !accentTouched) {
      return { status: 400, data: { error: 'Nothing to update.' } }
    }

    if (logoTouched) {
      const incoming = body.logoDataUrl
      if (incoming == null || incoming === '') {
        update['branding.logoDataUrl'] = null
        update['branding.logoUpdatedAt'] = null
      } else {
        const result = await processLogoDataUrl(incoming)
        if ('error' in result) {
          return { status: 400, data: { error: result.error } }
        }
        update['branding.logoDataUrl'] = result.dataUrl
        update['branding.logoUpdatedAt'] = new Date()
      }
    }

    if (accentTouched) {
      const accent = validateAccentColor(body.accentColor)
      if (accent && typeof accent === 'object' && 'error' in accent) {
        return { status: 400, data: { error: accent.error } }
      }
      update['branding.accentColor'] = accent
    }

    const org = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: update },
      { new: true },
    ).select('branding').lean<any>()

    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'branding.update',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: {
        logoUpdated: logoTouched,
        accentUpdated: accentTouched,
      },
      request,
    })

    return {
      data: {
        branding: {
          logoDataUrl: org.branding?.logoDataUrl || null,
          logoUpdatedAt: org.branding?.logoUpdatedAt || null,
          accentColor: org.branding?.accentColor || null,
        },
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'DELETE /api/organizations/branding',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-branding-delete',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      {
        $set: {
          'branding.logoDataUrl': null,
          'branding.logoUpdatedAt': null,
          'branding.accentColor': null,
        },
      },
      { new: true },
    )
    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'branding.clear',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      request,
    })

    return { data: { message: 'Branding cleared' } }
  },
})
