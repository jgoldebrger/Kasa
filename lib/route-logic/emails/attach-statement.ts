import { Types } from 'mongoose'
import { Organization, Statement, Family } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { generateStatementPDF } from '@/lib/email-utils'
import {
  loadStatementPeriod,
  buildTransactionList,
  statementSnapshotFromPeriod,
} from '@/lib/statements/period'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { hasMinRole } from '@/lib/auth-helpers'
import { email as emailSchemas } from '@/lib/schemas'

export async function generateStatementAttachment(
  organizationId: string,
  familyId: string,
  statementId?: string,
): Promise<{ filename: string; contentBase64: string } | { error: string; status: number }> {
  let dbStatement: any
  if (statementId) {
    if (!Types.ObjectId.isValid(statementId)) {
      return { error: 'Invalid statement id', status: 400 }
    }
    dbStatement = await Statement.findOne({
      _id: statementId,
      organizationId,
      familyId,
    }).lean<any>()
    if (!dbStatement) {
      return { error: 'Statement not found', status: 404 }
    }
  } else {
    dbStatement = await Statement.findOne({ organizationId, familyId })
      .sort({ date: -1, _id: -1 })
      .lean<any>()
    if (!dbStatement) {
      return { error: 'No statement found for this family', status: 404 }
    }
    statementId = String(dbStatement._id)
  }

  const openingBalanceData = await calculateFamilyBalance(
    familyId,
    organizationId,
    new Date(new Date(dbStatement.fromDate).getTime() - 1),
  )
  const period = await loadStatementPeriod({
    organizationId,
    familyId,
    fromDate: new Date(dbStatement.fromDate),
    toDate: new Date(dbStatement.toDate),
    openingBalance: openingBalanceData.balance,
  })
  const refreshedStatement = await Statement.findOneAndUpdate(
    { _id: statementId, organizationId },
    { $set: statementSnapshotFromPeriod(openingBalanceData.balance, period) },
    { new: true },
  ).lean<any>()
  const statement = refreshedStatement ?? dbStatement
  const transactions = buildTransactionList(period)

  const fam = await Family.findOne({ _id: familyId, organizationId })
    .select('name')
    .lean<{ name?: string }>()
  const familyName = fam?.name || 'Family'

  const org = await Organization.findById(organizationId)
    .select('name letterhead currency locale')
    .lean<{ name?: string; letterhead?: any; currency?: string; locale?: string }>()

  const pdfBuffer = await generateStatementPDF(
    statement,
    familyName,
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

  const filename = `Statement_${statement.statementNumber}.pdf`
  return {
    filename,
    contentBase64: Buffer.from(pdfBuffer).toString('base64'),
  }
}

export const POST = handler({
  auth: 'org',
  body: emailSchemas.attachStatementBody,
  name: 'POST /api/emails/attach-statement',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'attach-statement',
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

    const result = await generateStatementAttachment(
      ctx!.organizationId,
      familyId,
      body.statementId,
    )
    if ('error' in result) {
      return { status: result.status, data: { error: result.error } }
    }

    return { data: result }
  },
})
