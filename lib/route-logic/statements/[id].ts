import { handler } from '@/lib/api/handler'
import { Statement } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import {
  loadStatementPeriod,
  buildTransactionList,
  statementSnapshotFromPeriod,
} from '@/lib/statements/period'
import { checkRateLimit } from '@/lib/rate-limit'

// GET - Get statement details with all transactions
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
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

    const statement = await Statement.findOne({ _id: params.id, organizationId: ctx!.organizationId })
    if (!statement) {
      return { status: 404, data: { error: 'Statement not found' } }
    }

    const openingBalanceData = await calculateFamilyBalance(
      statement.familyId.toString(),
      ctx!.organizationId,
      new Date(statement.fromDate.getTime() - 1),
    )
    const period = await loadStatementPeriod({
      organizationId: ctx!.organizationId,
      familyId: statement.familyId.toString(),
      fromDate: statement.fromDate,
      toDate: statement.toDate,
      openingBalance: openingBalanceData.balance,
    })

    const refreshed = await Statement.findOneAndUpdate(
      { _id: statement._id, organizationId: ctx!.organizationId, familyId: statement.familyId },
      { $set: statementSnapshotFromPeriod(openingBalanceData.balance, period) },
      { new: true },
    )

    const transactions = buildTransactionList(period)

    return {
      data: {
        statement: refreshed ?? statement,
        transactions,
      },
    }
  },
})
