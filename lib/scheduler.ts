// Scheduler for automatic monthly statement generation
// This can be called by a cron job or scheduled task

import { Types } from 'mongoose'
import connectDB from './database'
import { Statement, Family, Organization, nextCounter } from './models'
import { calculateFamilyBalance } from './calculations'
import { loadStatementPeriod, statementSnapshotFromPeriod } from './statements/period'
import {
  previousStatementPeriodBounds,
  tolerantMsRange,
} from './date-utils'
import { DEFAULT_FAMILY_BATCH_SIZE, runChunkedFamilies } from './jobs'

export type GenerateMonthlyStatementsOptions = {
  familyCursor?: string | null
  batchSize?: number
  /** When set, process one family batch and self-HTTP for the rest. */
  selfUrl?: string
}

type FamilyDoc = { _id: Types.ObjectId; name?: string }

type PeriodContext = {
  targetYear: number
  targetMonth: number
  fromDate: Date
  toDate: Date
}

type FamilyProcessResult =
  | { kind: 'generated'; familyId: string; familyName?: string; statementNumber: string }
  | { kind: 'refreshed' }

async function loadPeriodContext(
  organizationId: string,
  year?: number,
  month?: number,
): Promise<PeriodContext> {
  const org = await Organization.findById(organizationId)
    .select('timezone monthlyStatementCalendar')
    .lean<{ timezone?: string; monthlyStatementCalendar?: 'gregorian' | 'hebrew' }>()

  const periodBounds =
    year !== undefined && month !== undefined
      ? previousStatementPeriodBounds(org?.monthlyStatementCalendar, org?.timezone, new Date(), {
          year,
          month,
        })
      : previousStatementPeriodBounds(org?.monthlyStatementCalendar, org?.timezone)

  return {
    targetYear: periodBounds.year,
    targetMonth: periodBounds.month,
    fromDate: periodBounds.fromDate,
    toDate: periodBounds.toDate,
  }
}

async function processFamilyForStatement(
  organizationId: string,
  family: FamilyDoc,
  period: PeriodContext,
): Promise<FamilyProcessResult> {
  const { fromDate, toDate, targetYear, targetMonth } = period

  const existingStatement = await Statement.findOne({
    organizationId,
    familyId: family._id,
    fromDate: tolerantMsRange(fromDate),
    toDate: tolerantMsRange(toDate),
  })

  if (existingStatement) {
    const openingBalanceData = await calculateFamilyBalance(
      family._id.toString(),
      organizationId,
      new Date(fromDate.getTime() - 1),
    )
    const openingBalance = openingBalanceData.balance
    const loaded = await loadStatementPeriod({
      organizationId,
      familyId: family._id.toString(),
      fromDate,
      toDate,
      openingBalance,
    })
    await Statement.findOneAndUpdate(
      { _id: existingStatement._id, organizationId, familyId: family._id },
      { $set: statementSnapshotFromPeriod(openingBalance, loaded) },
    )
    console.log(`Refreshed existing statement for ${family.name} - ${targetMonth}/${targetYear}`)
    return { kind: 'refreshed' }
  }

  const openingBalanceData = await calculateFamilyBalance(
    family._id.toString(),
    organizationId,
    new Date(fromDate.getTime() - 1),
  )
  const openingBalance = openingBalanceData.balance

  const loaded = await loadStatementPeriod({
    organizationId,
    familyId: family._id.toString(),
    fromDate,
    toDate,
    openingBalance,
  })

  const statementCount = await Statement.countDocuments({ organizationId, familyId: family._id })
  const seq = await nextCounter(
    `stmt:${organizationId}:${family._id.toString()}`,
    async () => statementCount,
  )
  const statementNumber = `STMT-${family._id.toString().slice(-6)}-${seq}`

  try {
    const statement = await Statement.create({
      organizationId,
      familyId: family._id,
      statementNumber,
      date: new Date(),
      fromDate,
      toDate,
      ...statementSnapshotFromPeriod(openingBalance, loaded),
    })
    console.log(`Generated statement for ${family.name}: ${statementNumber}`)
    return {
      kind: 'generated',
      familyId: family._id.toString(),
      familyName: family.name,
      statementNumber: statement.statementNumber,
    }
  } catch (err: any) {
    if (err?.code === 11000) {
      const raced = await Statement.findOne({
        organizationId,
        familyId: family._id,
        fromDate: tolerantMsRange(fromDate),
        toDate: tolerantMsRange(toDate),
      })
      if (raced) return { kind: 'refreshed' }
    }
    throw err
  }
}

async function processFamilyBatch(
  organizationId: string,
  period: PeriodContext,
  familyCursor: string | null,
  batchSize: number,
): Promise<{
  generated: number
  failed: number
  statements: { familyId: string; familyName?: string; statementNumber: string }[]
  errors: { familyId: string; familyName?: string; error: string }[]
  hasMore: boolean
  familyCursorOut: string | null
}> {
  const query: Record<string, unknown> = { organizationId }
  if (familyCursor && Types.ObjectId.isValid(familyCursor)) {
    query._id = { $gt: new Types.ObjectId(familyCursor) }
  }
  const families = await Family.find(query)
    .sort({ _id: 1 })
    .limit(batchSize + 1)
    .select('_id name')
    .lean<FamilyDoc[]>()

  const hasMore = families.length > batchSize
  const batch = hasMore ? families.slice(0, batchSize) : families
  const familyCursorOut = hasMore ? batch[batch.length - 1]._id.toString() : null

  const acc = {
    generated: 0,
    failed: 0,
    statements: [] as { familyId: string; familyName?: string; statementNumber: string }[],
    errors: [] as { familyId: string; familyName?: string; error: string }[],
  }

  for (const family of batch) {
    try {
      const outcome = await processFamilyForStatement(organizationId, family, period)
      if (outcome.kind === 'generated') {
        acc.generated += 1
        acc.statements.push({
          familyId: outcome.familyId,
          familyName: outcome.familyName,
          statementNumber: outcome.statementNumber,
        })
      }
    } catch (error: any) {
      console.error(`Error generating statement for ${family.name}:`, error)
      acc.failed += 1
      acc.errors.push({
        familyId: family._id.toString(),
        familyName: family.name,
        error: error.message,
      })
    }
  }

  return { ...acc, hasMore, familyCursorOut }
}

export async function generateMonthlyStatements(
  organizationId: string,
  year?: number,
  month?: number,
  options?: GenerateMonthlyStatementsOptions,
) {
  try {
    if (!organizationId) throw new Error('generateMonthlyStatements: organizationId is required')
    await connectDB()

    const period = await loadPeriodContext(organizationId, year, month)
    const batchSize = options?.batchSize ?? DEFAULT_FAMILY_BATCH_SIZE
    const selfUrl = options?.selfUrl

    if (selfUrl) {
      const continuationParams: Record<string, string> = { organizationId }
      if (year !== undefined && month !== undefined) {
        continuationParams.year = String(year)
        continuationParams.month = String(month)
      }

      let generated = 0
      let failed = 0
      const statements: { familyId: string; familyName?: string; statementNumber: string }[] = []
      const errors: { familyId: string; familyName?: string; error: string }[] = []

      const chunk = await runChunkedFamilies({
        name: 'generate-monthly-statements-families',
        organizationId,
        batchSize,
        familyCursor: options.familyCursor ?? null,
        selfUrl,
        continuationParams,
        perFamily: async (family) => {
          const outcome = await processFamilyForStatement(organizationId, family, period)
          if (outcome.kind === 'generated') {
            generated += 1
            statements.push({
              familyId: outcome.familyId,
              familyName: outcome.familyName,
              statementNumber: outcome.statementNumber,
            })
          }
        },
      })

      return {
        success: true,
        month: period.targetMonth,
        year: period.targetYear,
        generated,
        failed: failed + chunk.failed,
        statements,
        errors: [
          ...errors,
          ...chunk.errors.map((e) => ({
            familyId: e.familyId,
            error: e.error,
          })),
        ],
        hasMore: chunk.hasMore,
        familyCursorOut: chunk.familyCursorOut,
      }
    }

    let familyCursor: string | null = options?.familyCursor ?? null
    const totals = {
      generated: 0,
      failed: 0,
      statements: [] as { familyId: string; familyName?: string; statementNumber: string }[],
      errors: [] as { familyId: string; familyName?: string; error: string }[],
    }

    for (;;) {
      const batch = await processFamilyBatch(organizationId, period, familyCursor, batchSize)
      totals.generated += batch.generated
      totals.failed += batch.failed
      totals.statements.push(...batch.statements)
      totals.errors.push(...batch.errors)
      if (!batch.hasMore) break
      familyCursor = batch.familyCursorOut
    }

    return {
      success: true,
      month: period.targetMonth,
      year: period.targetYear,
      generated: totals.generated,
      failed: totals.failed,
      statements: totals.statements,
      errors: totals.errors,
      hasMore: false,
      familyCursorOut: null,
    }
  } catch (error: any) {
    console.error('Error in generateMonthlyStatements:', error)
    throw error
  }
}
