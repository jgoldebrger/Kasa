import { NextResponse } from 'next/server'
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

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'POST /api/statements/generate-pdf',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'generate-statement-pdf',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { error: 'Request body required' } }
    }
    const { statement: clientStatement, familyName: clientFamilyName } = body as {
      statement?: { _id?: string }
      familyName?: string
    }

    const statementId = clientStatement?._id
    if (!statementId || typeof statementId !== 'string' || !Types.ObjectId.isValid(statementId)) {
      return { status: 400, data: { error: 'statement._id is required' } }
    }

    const dbStatement = await Statement.findOne({
      _id: statementId,
      organizationId: ctx!.organizationId,
    }).lean<any>()
    if (!dbStatement) {
      return { status: 404, data: { error: 'Statement not found' } }
    }

    const openingBalanceData = await calculateFamilyBalance(
      dbStatement.familyId.toString(),
      ctx!.organizationId,
      new Date(new Date(dbStatement.fromDate).getTime() - 1),
    )
    const period = await loadStatementPeriod({
      organizationId: ctx!.organizationId,
      familyId: dbStatement.familyId.toString(),
      fromDate: new Date(dbStatement.fromDate),
      toDate: new Date(dbStatement.toDate),
      openingBalance: openingBalanceData.balance,
    })
    const refreshedStatement = await Statement.findOneAndUpdate(
      { _id: statementId, organizationId: ctx!.organizationId },
      { $set: statementSnapshotFromPeriod(openingBalanceData.balance, period) },
      { new: true },
    ).lean<any>()
    const statement = refreshedStatement ?? dbStatement
    const transactions = buildTransactionList(period)

    const fam = await Family.findOne({
      _id: dbStatement.familyId,
      organizationId: ctx!.organizationId,
    })
      .select('name')
      .lean<{ name?: string }>()
    const familyName = fam?.name || clientFamilyName || 'Family'

    const org = await Organization.findById(ctx!.organizationId)
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
    const statementNumber = statement.statementNumber

    const pdfArray = new Uint8Array(pdfBuffer)

    return new NextResponse(pdfArray, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Statement_${statementNumber}.pdf"`,
      },
    })
  },
})
