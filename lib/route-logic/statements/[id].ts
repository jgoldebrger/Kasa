import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Statement } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import {
  loadStatementPeriod,
  buildTransactionList,
  statementSnapshotFromPeriod,
} from '@/lib/statements/period'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { hasMinRole } from '@/lib/auth-helpers'
import { checkRateLimit } from '@/lib/rate-limit'

/** Shared statement detail for admins and email-linked members. */
export async function loadStatementDetailForContext(
  organizationId: string,
  statementId: string,
  userId: string,
  role: import('@/lib/auth-helpers').Role,
) {
  const statement = await Statement.findOne({ _id: statementId, organizationId })
  if (!statement) return { status: 404 as const, error: 'Statement not found' }

  if (!hasMinRole(role, 'admin')) {
    const access = await checkMemberFamilyFinancialAccess(
      organizationId,
      statement.familyId.toString(),
      userId,
      role,
    )
    if (!access.allowed) {
      return { status: 403 as const, error: 'Financial access denied for this family' }
    }
  }

  const openingBalanceData = await calculateFamilyBalance(
    statement.familyId.toString(),
    organizationId,
    new Date(statement.fromDate.getTime() - 1),
  )
  const period = await loadStatementPeriod({
    organizationId,
    familyId: statement.familyId.toString(),
    fromDate: statement.fromDate,
    toDate: statement.toDate,
    openingBalance: openingBalanceData.balance,
  })

  const refreshed = await Statement.findOneAndUpdate(
    { _id: statement._id, organizationId, familyId: statement.familyId },
    { $set: statementSnapshotFromPeriod(openingBalanceData.balance, period) },
    { new: true },
  )

  return {
    status: 200 as const,
    data: {
      statement: refreshed ?? statement,
      transactions: buildTransactionList(period),
    },
  }
}

// GET - Statement details (admin or email-linked member for that family).
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  name: 'GET /api/statements/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'statement-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid statement id' } }
    }

    const result = await loadStatementDetailForContext(
      ctx!.organizationId,
      id,
      ctx!.userId,
      ctx!.role,
    )
    if (result.status !== 200) {
      return { status: result.status, data: { error: result.error } }
    }
    return { data: result.data }
  },
})
