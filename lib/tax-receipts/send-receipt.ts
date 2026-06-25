/**
 * Build + send one family's annual tax receipt over email.
 *
 * Mirrors `lib/statements/send-statement.ts` but for receipts:
 *   - Looks up the family, the org letterhead, and the family's
 *     calendar-year dues payments.
 *   - Skips families with `totalPaid === 0` (returns a non-ok result
 *     with a descriptive error so the worker can record it).
 *   - Builds the PDF and emails it via the supplied transporter.
 *
 * Respects per-family `emailOptOut` and falls back gracefully when
 * no `family.email` is on file.
 */

import nodemailer from 'nodemailer'
import { Family, Organization, Payment } from '@/lib/models'
import { generateTaxReceiptPDF } from '@/lib/email-utils'
import { escapeHtml } from '@/lib/html-escape'
import { sendEmail } from '@/lib/mail'
import { Types } from 'mongoose'
import { membershipDuesYearFilter, netMembershipPaymentAmount } from '@/lib/tax-receipts/queries'

export interface ReceiptEmailCreds {
  email: string
  password: string
  fromName: string
}

export interface SendReceiptInput {
  organizationId: string
  familyId: string
  year: number
  config: ReceiptEmailCreds
  transporter?: nodemailer.Transporter
}

export interface SendReceiptResult {
  ok: boolean
  email: string | null
  totalPaid?: number
  error?: string
}

export async function sendOneFamilyTaxReceipt(input: SendReceiptInput): Promise<SendReceiptResult> {
  const orgId = new Types.ObjectId(String(input.organizationId))
  const familyOid = new Types.ObjectId(String(input.familyId))

  const family = await Family.findOne({ _id: familyOid, organizationId: orgId })
  if (!family) return { ok: false, email: null, error: 'Family not found' }
  if (family.emailOptOut) {
    return { ok: false, email: family.email || null, error: 'Family opted out of bulk emails' }
  }
  if (!family.email) return { ok: false, email: null, error: 'No email on file' }

  const [org, payments] = await Promise.all([
    Organization.findById(orgId).select('name letterhead currency locale').lean<any>(),
    Payment.find(
      await membershipDuesYearFilter(input.year, input.organizationId, { familyId: familyOid }),
    )
      .select('amount refundedAmount paymentDate paymentMethod notes')
      .sort({ paymentDate: 1 })
      .lean<any[]>(),
  ])

  if (!org) return { ok: false, email: family.email, error: 'Organization not found' }

  // Net refundedAmount before tallying or rendering. The list endpoint,
  // per-family PDF, and bulk-ZIP all already share this logic — sending a
  // receipt that overstates contributions because of a refunded charge
  // would be a real reporting bug for the recipient family.
  const netPayments = payments
    .map((p) => ({
      date: p.paymentDate,
      method: String(p?.paymentMethod || 'cash'),
      amount: netMembershipPaymentAmount(p),
      notes: String(p?.notes || ''),
    }))
    .filter((p) => p.amount > 0)
  const totalPaid = netPayments.reduce((acc, p) => acc + p.amount, 0)
  if (totalPaid === 0) {
    return {
      ok: false,
      email: family.email,
      totalPaid: 0,
      error: `No membership-dues payments recorded for ${input.year}`,
    }
  }

  try {
    const pdfBuffer = await generateTaxReceiptPDF(
      {
        name: org.name || '',
        locale: org.locale,
        currency: org.currency,
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
      input.year,
    )

    const safeName = String(family.name || 'family').replace(/[^a-z0-9_\-]+/gi, '_')
    // Format the total using the org's configured locale / currency so the
    // body of the email matches the PDF (previously hard-coded en-US/USD
    // even for orgs using ₪ / € / etc).
    const emailLocale = (org as any).locale || 'en-US'
    const emailCurrency = String((org as any).currency || 'USD').toUpperCase()
    let formatted: string
    try {
      formatted = new Intl.NumberFormat(emailLocale, {
        style: 'currency',
        currency: emailCurrency,
      }).format(totalPaid)
    } catch {
      formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(totalPaid)
    }

    const subject = `${org.name} – Tax Receipt for ${input.year}`
    const textBody =
      `Hello ${family.name || 'friend'},\n\n` +
      `Attached is your annual donation receipt from ${org.name} for tax year ${input.year}.\n` +
      `Total contributions on record: ${formatted}.\n\n` +
      `Please keep this receipt for your tax records.\n`
    const htmlBody = `<p>Hello ${escapeHtml(family.name || 'friend')},</p>
<p>Attached is your annual donation receipt from <strong>${escapeHtml(org.name)}</strong> for tax year <strong>${input.year}</strong>.</p>
<p>Total contributions on record: <strong>${formatted}</strong>.</p>
<p>Please keep this receipt for your tax records.</p>`

    const sendResult = await sendEmail({
      organizationId: input.organizationId,
      familyId: family._id.toString(),
      to: family.email,
      subject,
      text: textBody,
      html: htmlBody,
      kind: 'tax-receipt',
      relatedResource: { type: 'tax-receipt', id: String(input.year) },
      tracking: { opens: true, clicks: false },
      config: input.config,
      transporter: input.transporter,
      attachments: [
        {
          filename: `Tax_Receipt_${safeName}_${input.year}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    if (!sendResult.ok) {
      return {
        ok: false,
        email: family.email,
        totalPaid,
        error: sendResult.error || 'Send failed',
      }
    }

    return { ok: true, email: family.email, totalPaid }
  } catch (error: any) {
    console.error('[tax-receipts] send failed for family', input.familyId, error)
    return {
      ok: false,
      email: family.email,
      totalPaid,
      error: error?.message || 'Unknown send failure',
    }
  }
}
