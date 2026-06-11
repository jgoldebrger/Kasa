/**
 * Per-family year-end tax receipt PDF.
 *
 * GET /api/tax-receipts/[familyId]/pdf?year=YYYY — admin-only.
 */

import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { Family, Organization, Payment } from '@/lib/models'
import { generateTaxReceiptPDF } from '@/lib/email-utils'
import {
  membershipDuesYearFilter,
  netMembershipPaymentAmount,
} from '@/lib/tax-receipts/queries'
import { yearParam } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['familyId'],
  name: 'GET /api/tax-receipts/[familyId]/pdf',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'tax-receipt-pdf',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyId = params.familyId as string

    const yearStr = request.nextUrl.searchParams.get('year')
    const yearParsed = yearParam.safeParse(yearStr)
    if (!yearParsed.success) {
      return { status: 400, data: { error: 'year query param is required' } }
    }
    const year = yearParsed.data

    const orgId = new Types.ObjectId(String(ctx!.organizationId))
    const familyOid = new Types.ObjectId(familyId)

    const [org, family, payments] = await Promise.all([
      Organization.findById(orgId).select('name letterhead currency locale').lean<any>(),
      Family.findOne({ _id: familyOid, organizationId: orgId })
        .select('name street city state zip')
        .lean<any>(),
      loadAllByIdCursor<any>(
        (filter, limit) =>
          Payment.find(filter)
            .select('amount refundedAmount paymentDate paymentMethod notes')
            .sort({ paymentDate: 1, _id: 1 })
            .limit(limit)
            .lean<any[]>(),
        await membershipDuesYearFilter(year, ctx!.organizationId, { familyId: familyOid }),
      ),
    ])

    if (!org) return { status: 404, data: { error: 'Organization not found' } }
    if (!family) return { status: 404, data: { error: 'Family not found' } }

    const netPayments = payments
      .map((p) => ({
        date: p.paymentDate,
        method: String(p.paymentMethod || 'cash'),
        amount: netMembershipPaymentAmount(p),
        notes: String(p.notes || ''),
      }))
      .filter((p) => p.amount > 0)

    const total = netPayments.reduce((acc, p) => acc + p.amount, 0)
    if (total === 0) {
      return {
        status: 400,
        data: { error: `No membership-dues payments were recorded for ${year}.` },
      }
    }

    const pdfBuffer = await generateTaxReceiptPDF(
      {
        name: org.name || '',
        locale: (org as any).locale,
        currency: (org as any).currency,
        letterhead: org.letterhead || null,
      },
      {
        name: family.name || '',
        street: family.street || '',
        city: family.city || '',
        state: family.state || '',
        zip: family.zip || '',
      },
      netPayments,
      year,
    )

    const safeName = String(family.name || 'family').replace(/[^a-z0-9_\-]+/gi, '_')
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Tax_Receipt_${safeName}_${year}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  },
})
