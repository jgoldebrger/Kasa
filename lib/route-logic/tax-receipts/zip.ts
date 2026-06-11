/**
 * Bulk download of year-end tax receipt PDFs as a single ZIP.
 *
 * GET /api/tax-receipts/zip?year=YYYY — admin-only.
 */

import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { Organization, Payment } from '@/lib/models'
import { generateTaxReceiptPDF } from '@/lib/email-utils'
import { streamZip, type ZipEntryInput } from '@/lib/zip'
import {
  membershipDuesYearFilter,
  netMembershipPaymentAmount,
} from '@/lib/tax-receipts/queries'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor, familyBatches } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/tax-receipts/zip',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'tax-receipts-zip',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const yearStr = request.nextUrl.searchParams.get('year')
    const year = Number(yearStr)
    if (!Number.isFinite(year) || year < 1900 || year > 2999) {
      return { status: 400, data: { error: 'year query param is required' } }
    }

    const orgId = new Types.ObjectId(String(ctx!.organizationId))

    const org = await Organization.findById(orgId).select('name letterhead currency locale').lean<any>()
    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    const paymentFilter = await membershipDuesYearFilter(year, ctx!.organizationId)
    const payments = await loadAllByIdCursor<any>(
      (filter, limit) =>
        Payment.find(filter)
          .select('familyId amount refundedAmount paymentDate paymentMethod notes')
          .sort({ _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      paymentFilter,
    )

    if (payments.length === 0) {
      return {
        status: 400,
        data: { error: `No membership-dues payments were recorded for ${year}.` },
      }
    }

    const byFamily = new Map<string, { totalPaid: number; payments: any[] }>()
    for (const p of payments) {
      const net = netMembershipPaymentAmount(p)
      if (net <= 0) continue
      const fid = String(p.familyId)
      let bucket = byFamily.get(fid)
      if (!bucket) {
        bucket = { totalPaid: 0, payments: [] }
        byFamily.set(fid, bucket)
      }
      bucket.totalPaid += net
      bucket.payments.push({
        date: p.paymentDate,
        method: String(p.paymentMethod || 'cash'),
        amount: net,
        notes: String(p.notes || ''),
      })
    }

    const familyById = new Map<string, any>()
    for await (const batch of familyBatches(String(ctx!.organizationId), {
      select: 'name street city state zip',
    })) {
      for (const fam of batch) {
        const id = String(fam._id)
        if (byFamily.has(id)) familyById.set(id, fam)
      }
    }

    const eligible = Array.from(familyById.entries())
      .map(([id, fam]) => ({ fam, bucket: byFamily.get(id) }))
      .filter((row) => row.bucket && row.bucket.totalPaid > 0)

    if (eligible.length === 0) {
      return { status: 400, data: { error: `No tax receipts to generate for ${year}.` } }
    }

    const zipName = `Tax_Receipts_${year}.zip`

    async function* entryProvider(): AsyncGenerator<ZipEntryInput, void, void> {
      const usedNames = new Set<string>()
      for (const { fam, bucket } of eligible) {
        if (!bucket) continue
        const pdfBuffer = await generateTaxReceiptPDF(
          {
            name: org.name || '',
            locale: (org as any).locale,
            currency: (org as any).currency,
            letterhead: org.letterhead || null,
          },
          {
            name: fam.name || '',
            street: fam.street || '',
            city: fam.city || '',
            state: fam.state || '',
            zip: fam.zip || '',
          },
          bucket.payments,
          year,
        )
        const baseName = String(fam.name || 'family').replace(/[^a-z0-9_\-]+/gi, '_')
        let filename = `Tax_Receipt_${baseName}_${year}.pdf`
        let n = 2
        while (usedNames.has(filename)) {
          filename = `Tax_Receipt_${baseName}_${year}_${n}.pdf`
          n += 1
        }
        usedNames.add(filename)
        yield { name: filename, data: pdfBuffer }
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {},
      async start(controller) {
        try {
          for await (const chunk of streamZip(entryProvider())) {
            controller.enqueue(new Uint8Array(chunk))
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  },
})
