/**
 * Per-organization letterhead settings.
 *
 * GET  /api/organizations/letterhead — return the active org's letterhead.
 * PUT  /api/organizations/letterhead — owner/admin updates the letterhead.
 *
 * Currently consumed by the tax-receipt PDF generator
 * (`generateTaxReceiptPDF` in lib/email-utils.ts). Statements still use
 * the hardcoded "Kasa Family Management" header — wiring those through
 * to `letterhead.*` is a follow-up.
 *
 * All fields are independent free-form strings, defaulting to empty.
 * Orgs opt in piecewise: an empty value is treated as "skip this line"
 * by every downstream renderer, so a half-populated letterhead still
 * produces a clean-looking document.
 */

import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Conservative caps so an admin can't paste a novel into a single
// field and break the PDF. Numbers are generous — addresses + EINs
// stay well under 200 chars in practice. Free-text fields get 500.
const shortField = z.string().max(200)
const longField = z.string().max(500)

const putBody = z.object({
  addressLine1: shortField.optional(),
  addressLine2: shortField.optional(),
  city: shortField.optional(),
  state: shortField.optional(),
  zip: shortField.optional(),
  phone: shortField.optional(),
  email: shortField.optional(),
  taxId: shortField.optional(),
  signatureName: shortField.optional(),
  signatureTitle: shortField.optional(),
  statementFooter: longField.optional(),
  receiptThankYou: longField.optional(),
  taxDeductibleDisclosure: longField.optional(),
})

type LetterheadShape = {
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  zip: string
  phone: string
  email: string
  taxId: string
  signatureName: string
  signatureTitle: string
  statementFooter: string
  receiptThankYou: string
  taxDeductibleDisclosure: string
}

const EMPTY_LETTERHEAD: LetterheadShape = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  taxId: '',
  signatureName: '',
  signatureTitle: '',
  statementFooter: '',
  receiptThankYou: '',
  taxDeductibleDisclosure: '',
}

function normalizeLetterhead(raw: any): LetterheadShape {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: any = { ...EMPTY_LETTERHEAD }
  for (const key of Object.keys(EMPTY_LETTERHEAD) as (keyof LetterheadShape)[]) {
    const v = src[key]
    if (typeof v === 'string') out[key] = v
  }
  return out as LetterheadShape
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/organizations/letterhead',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-letterhead-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('letterhead')
      .lean<any>()
    if (!org) return { status: 404, data: { error: 'Organization not found' } }
    return { data: normalizeLetterhead(org.letterhead) }
  },
})

export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  body: putBody,
  name: 'PUT /api/organizations/letterhead',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-letterhead-update',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    // Build a $set on the nested subdoc keys that were sent. Keeping
    // untouched fields out of $set means a partial form save (e.g.
    // only address) won't blow away anything the admin didn't touch.
    const update: Record<string, unknown> = {}
    const touched: string[] = []
    for (const key of Object.keys(EMPTY_LETTERHEAD) as (keyof LetterheadShape)[]) {
      if (body[key] !== undefined) {
        update[`letterhead.${key}`] = String(body[key] ?? '').trim()
        touched.push(key)
      }
    }

    if (touched.length === 0) {
      return { status: 400, data: { error: 'Nothing to update.' } }
    }

    const org = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: update },
      { new: true },
    )
      .select('letterhead')
      .lean<any>()

    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'organization.letterhead.update',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: { touched },
      request,
    })

    return { data: normalizeLetterhead(org.letterhead) }
  },
})
