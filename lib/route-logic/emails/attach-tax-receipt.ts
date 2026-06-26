import { Types } from 'mongoose'
import { Organization, Family, Payment } from '@/lib/models'
import { generateTaxReceiptPDF } from '@/lib/email-utils'
import { membershipDuesYearFilter, netMembershipPaymentAmount } from '@/lib/tax-receipts/queries'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { email as emailSchemas } from '@/lib/schemas'

export async function generateTaxReceiptAttachment(
  organizationId: string,
  familyId: string,
  year: number,
): Promise<{ filename: string; contentBase64: string } | { error: string; status: number }> {
  const orgId = new Types.ObjectId(organizationId)
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
      await membershipDuesYearFilter(year, organizationId, { familyId: familyOid }),
    ),
  ])

  if (!org) return { error: 'Organization not found', status: 404 }
  if (!family) return { error: 'Family not found', status: 404 }

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
      error: `No membership-dues payments were recorded for ${year}.`,
      status: 400,
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
  return {
    filename: `Tax_Receipt_${safeName}_${year}.pdf`,
    contentBase64: Buffer.from(pdfBuffer).toString('base64'),
  }
}

export const POST = handler({
  auth: 'org',
  body: emailSchemas.attachTaxReceiptBody,
  name: 'POST /api/emails/attach-tax-receipt',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'attach-tax-receipt',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyId = body.familyId
    if (!hasMinRole(ctx!.role, 'admin')) {
      const access = await checkMemberFamilyFinancialAccess(
        ctx!.organizationId,
        familyId,
        ctx!.userId,
        ctx!.role,
      )
      if (!access.allowed) {
        return { status: 403, data: { error: 'Financial access denied for this family' } }
      }
    }

    const fam = await Family.findOne({ _id: familyId, organizationId: ctx!.organizationId })
      .select('_id')
      .lean()
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const result = await generateTaxReceiptAttachment(ctx!.organizationId, familyId, body.year)
    if ('error' in result) {
      return { status: result.status, data: { error: result.error } }
    }

    return { data: result }
  },
})
