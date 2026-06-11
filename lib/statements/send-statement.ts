/**
 * Build + send one family's statement PDF over email.
 *
 * Extracted from the bulk send-emails route so the new background worker
 * can call it one family at a time. Returns a small status object so the
 * caller can update job progress.
 */

import nodemailer from 'nodemailer'
import { Family, Statement, Organization, nextCounter } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { generateStatementPDF, StatementTransaction } from '@/lib/email-utils'
import { escapeHtml } from '@/lib/html-escape'
import { sanitizeFromName } from '@/lib/email-from-name'
import {
  loadStatementPeriod,
  buildTransactionList,
  statementSnapshotFromPeriod,
} from '@/lib/statements/period'
import { tolerantMsRange } from '@/lib/date-utils'

export interface EmailConfigCreds {
  email: string
  password: string
  fromName: string
}

export interface SendStatementInput {
  organizationId: string
  familyId: string
  fromDate: Date
  toDate: Date
  config: EmailConfigCreds
  /** Optional shared transporter — pool more sends inside one chunk. */
  transporter?: nodemailer.Transporter
}

export interface SendStatementResult {
  ok: boolean
  email: string | null
  error?: string
}

export async function sendOneFamilyStatement(
  input: SendStatementInput,
): Promise<SendStatementResult> {
  // Whole-body try so a Mongo blip on the Family.findOne lookup (or
  // anywhere else) is reported as a per-family failure instead of
  // throwing out of the bulk worker. The caller relies on this
  // function NEVER throwing — if it does, the worker mid-batch loses
  // progress counters for every family already processed in the
  // current claim, even though they were emailed.
  let familyEmail: string | null = null
  try {
    const family = await Family.findOne({
      _id: input.familyId,
      organizationId: input.organizationId,
    })
    if (!family) return { ok: false, email: null, error: 'Family not found' }
    if (!family.email) return { ok: false, email: null, error: 'No email on file' }
    familyEmail = family.email
    const openingBalanceData = await calculateFamilyBalance(
      family._id.toString(),
      input.organizationId,
      new Date(input.fromDate.getTime() - 1),
    )
    const openingBalance = openingBalanceData.balance

    // Both bounds are matched with a tiny ±999ms tolerance so we
    // discover legacy statements whose `toDate` (and occasionally
    // `fromDate`) was stored with millisecond drift by earlier code
    // paths — most importantly, the scheduler's old ms=000 last-second
    // form vs. the new ms=999 `endOfMonth()` value used by
    // send-monthly-emails. Without this, a bulk-email run for a
    // previously-generated month would silently insert a duplicate
    // Statement row for every family. Caller-supplied dates can be
    // arbitrary (admin-picked ranges), so we cannot assume the bound
    // sits at calendar end-of-month.
    const [period, statementCount, existingStatement] = await Promise.all([
      loadStatementPeriod({
        organizationId: input.organizationId,
        familyId: family._id.toString(),
        fromDate: input.fromDate,
        toDate: input.toDate,
        openingBalance,
      }),
      Statement.countDocuments({ familyId: family._id, organizationId: input.organizationId }),
      Statement.findOne({
        organizationId: input.organizationId,
        familyId: family._id,
        fromDate: tolerantMsRange(input.fromDate),
        toDate: tolerantMsRange(input.toDate),
      }),
    ])

    // Idempotent: reuse the existing statement record for this exact
    // period if one already exists. Previously every email pass inserted
    // a new row, so re-running the bulk job duplicated financial records.
    let statement = existingStatement
    if (!statement) {
      // Atomic per-family sequence. The previous `countDocuments + 1`
      // form raced under concurrent send: two workers / two clicks for
      // two different months on the same family both read N, both
      // wrote `STMT-…-N+1`. Different periods (different `fromDate`)
      // so the unique-on-(orgId, familyId, fromDate, toDate) index
      // didn't reject the duplicate — the family ended up with two
      // statements sharing the same human-facing number. `nextCounter`
      // (an atomic `$inc` on a per-scope row) is the same primitive
      // already used by `/api/statements`, `/api/members/.../statements`,
      // and `/api/statements/generate-monthly`. Seed once from the
      // existing countDocuments so legacy data picks a sane starting
      // point.
      const seq = await nextCounter(
        `stmt:${input.organizationId}:${family._id.toString()}`,
        async () => statementCount,
      )
      const statementNumber = `STMT-${family._id.toString().slice(-6)}-${seq}`
      try {
        statement = await Statement.create({
          familyId: family._id,
          organizationId: input.organizationId,
          statementNumber,
          date: new Date(),
          fromDate: input.fromDate,
          toDate: input.toDate,
          openingBalance,
          income: period.totalIncome,
          withdrawals: period.totalWithdrawals,
          expenses: period.totalExpenses,
          cycleCharges: period.totalCycleCharges,
          closingBalance: period.closingBalance,
        })
      } catch (err: any) {
        if (err?.code === 11000) {
          statement = await Statement.findOne({
            organizationId: input.organizationId,
            familyId: family._id,
            fromDate: tolerantMsRange(input.fromDate),
            toDate: tolerantMsRange(input.toDate),
          })
          if (!statement) throw err
        } else {
          throw err
        }
      }
    }

    // Re-sync the persisted snapshot from live ledger data before
    // building the PDF. Transaction lines always come from `period`;
    // if we kept a stale Statement row from an earlier generation, the
    // PDF summary totals would disagree with the line items on re-send.
    const snapshot = statementSnapshotFromPeriod(openingBalance, period)
    statement = await Statement.findOneAndUpdate(
      { _id: statement._id, organizationId: input.organizationId },
      { $set: snapshot },
      { new: true },
    )
    if (!statement) {
      return { ok: false, email: familyEmail, error: 'Statement record missing after update' }
    }

    const transactions: StatementTransaction[] = buildTransactionList(period)

    const org = await Organization.findById(input.organizationId)
      .select('name letterhead currency locale')
      .lean<{ name?: string; letterhead?: any; currency?: string; locale?: string }>()

    const pdfBuffer = await generateStatementPDF(
      statement.toObject(),
      family.name,
      transactions,
      org
        ? {
            name: org.name,
            letterhead: org.letterhead,
            currency: org.currency,
            locale: org.locale,
          }
        : null,
    )

    // Match the PDF generator's locale/currency so the email body and
    // the attached PDF agree. Falls back to en-US/USD when the org
    // hasn't set localization preferences.
    const emailLocale = org?.locale || 'en-US'
    const emailCurrency = (org?.currency || 'USD').toUpperCase()
    const formatDate = (date: Date | string) => {
      const d = new Date(date)
      try {
        return d.toLocaleDateString(emailLocale, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      } catch {
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      }
    }

    const formatCurrency = (amount: number) => {
      try {
        return new Intl.NumberFormat(emailLocale, {
          style: 'currency',
          currency: emailCurrency,
        }).format(amount)
      } catch {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(amount)
      }
    }

    const safeSubject = `Monthly Statement - ${String(statement.statementNumber || '').replace(/[\r\n]+/g, ' ')}`

    const cycleChargesForEmail = Number(statement.cycleCharges || 0)

    const transporter =
      input.transporter ??
      nodemailer.createTransport({
        service: 'gmail',
        auth: { user: input.config.email, pass: input.config.password },
      })

    const senderName = sanitizeFromName(input.config.fromName || org?.name)

    await transporter.sendMail({
      from: `"${senderName}" <${input.config.email}>`,
      to: family.email,
      subject: safeSubject,
      text:
        `Dear ${family.name},\n\n` +
        `Please find attached your monthly statement for the period ${formatDate(statement.fromDate)} to ${formatDate(statement.toDate)}.\n\n` +
        `Statement Summary:\n` +
        `- Statement Number: ${statement.statementNumber}\n` +
        `- Opening Balance: ${formatCurrency(statement.openingBalance)}\n` +
        `- Income: ${formatCurrency(statement.income)}\n` +
        `- Withdrawals: ${formatCurrency(statement.withdrawals)}\n` +
        (cycleChargesForEmail > 0
          ? `- Annual Dues Charged: ${formatCurrency(cycleChargesForEmail)}\n`
          : '') +
        `- Expenses: ${formatCurrency(statement.expenses)}\n` +
        `- Closing Balance: ${formatCurrency(statement.closingBalance)}\n\n` +
        `The detailed statement is attached as a PDF file.\n\nIf you have any questions, please contact us.\n\nBest regards,\n${senderName}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <p>Dear ${escapeHtml(family.name)},</p>
          <p>Please find attached your monthly statement for the period <strong>${escapeHtml(formatDate(statement.fromDate))}</strong> to <strong>${escapeHtml(formatDate(statement.toDate))}</strong>.</p>
          <h3 style="color: #4F46E5;">Statement Summary:</h3>
          <ul>
            <li><strong>Statement Number:</strong> ${escapeHtml(statement.statementNumber)}</li>
            <li><strong>Opening Balance:</strong> ${formatCurrency(statement.openingBalance)}</li>
            <li><strong>Income:</strong> <span style="color: #10b981;">${formatCurrency(statement.income)}</span></li>
            <li><strong>Withdrawals:</strong> <span style="color: #ef4444;">${formatCurrency(statement.withdrawals)}</span></li>
            ${cycleChargesForEmail > 0
              ? `<li><strong>Annual Dues Charged:</strong> <span style="color: #ef4444;">${formatCurrency(cycleChargesForEmail)}</span></li>`
              : ''}
            <li><strong>Expenses:</strong> <span style="color: #ef4444;">${formatCurrency(statement.expenses)}</span></li>
            <li><strong>Closing Balance:</strong> <strong>${formatCurrency(statement.closingBalance)}</strong></li>
          </ul>
          <p>The detailed statement is attached as a PDF file.</p>
          <p>If you have any questions, please contact us.</p>
          <p>Best regards,<br>${escapeHtml(senderName)}</p>
        </div>
      `,
      attachments: [
        {
          filename: `Statement_${String(statement.statementNumber || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100)}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    return { ok: true, email: family.email }
  } catch (err: any) {
    return { ok: false, email: familyEmail, error: err?.message || String(err) }
  }
}
