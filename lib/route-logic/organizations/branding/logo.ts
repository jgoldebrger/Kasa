/**
 * GET /api/organizations/branding/logo
 *
 * Streams the active org's logo as a binary PNG so the browser / CDN can cache
 * it long-term. The data URL stays on the Organization doc, but this endpoint
 * lets every page load reuse a single cached binary instead of re-shipping
 * the ~200KB data URL inline.
 *
 * Cache key: `?v=<logoUpdatedAt-ms>`. When the owner uploads a new logo,
 * `logoUpdatedAt` bumps, the URL changes, and browsers fetch fresh bytes.
 */

import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const DATA_URL_RE = /^data:image\/([a-z+]+);base64,(.+)$/i

export const GET = handler({
  auth: 'org',
  name: 'GET /api/organizations/branding/logo',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-branding-logo-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId).select('branding').lean<any>()

    const dataUrl: string | null = org?.branding?.logoDataUrl ?? null
    if (!dataUrl) {
      return NextResponse.json({ error: 'No logo' }, { status: 404 })
    }

    const match = DATA_URL_RE.exec(dataUrl)
    if (!match) {
      return NextResponse.json({ error: 'Malformed logo' }, { status: 500 })
    }

    const mime = `image/${match[1].toLowerCase()}`
    const buf = Buffer.from(match[2], 'base64')

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        // Private (per-user/org), but cached aggressively. The URL carries
        // the version stamp, so a fresh upload produces a new URL and the
        // browser fetches the new bytes without any TTL surprises.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Length': String(buf.length),
      },
    })
  },
})
