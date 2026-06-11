import { Statement, Family, Organization, nextCounter } from '@/lib/models'
import { familyBatches } from '@/lib/org-pagination'
import { calculateFamilyBalance } from '@/lib/calculations'
import { loadStatementPeriod, statementSnapshotFromPeriod } from '@/lib/statements/period'
import { HDate } from '@hebcal/hdate'
import {
  calendarMonthBoundsInTimeZone,
  getMonthInTimeZone,
  getYearInTimeZone,
  hebrewMonthBounds,
  startOfDayInTimeZone,
  tolerantMsRange,
} from '@/lib/date-utils'
import { sanitizeBatchErrors, sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'POST /api/statements/generate-monthly',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'generate-monthly-statements',
      { limit: 3, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { error: 'Request body required' } }
    }
    const { year, month } = body as { year?: number | string; month?: number | string }

    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone monthlyStatementCalendar')
      .lean<{ timezone?: string; monthlyStatementCalendar?: 'gregorian' | 'hebrew' }>()

    const isHebrew = org?.monthlyStatementCalendar === 'hebrew'
    if (year !== undefined && year !== null) {
      const y = Number(year)
      if (!Number.isFinite(y) || y < 1900 || y > 2200) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
    }
    if (month !== undefined && month !== null) {
      const m = Number(month)
      const maxMonth = isHebrew ? 13 : 12
      if (!Number.isFinite(m) || m < 1 || m > maxMonth) {
        return { status: 400, data: { error: 'Invalid month' } }
      }
    }

    const hebrewToday = new HDate(startOfDayInTimeZone(org?.timezone))
    const targetYear = Number(
      year ?? (isHebrew ? hebrewToday.getFullYear() : getYearInTimeZone(org?.timezone)),
    )
    const targetMonth = Number(
      month ?? (isHebrew ? hebrewToday.getMonth() : getMonthInTimeZone(org?.timezone)),
    )

    const { fromDate, toDate } = isHebrew
      ? hebrewMonthBounds(targetYear, targetMonth, org?.timezone)
      : calendarMonthBoundsInTimeZone(targetYear, targetMonth, org?.timezone)

    const generatedStatements = []
    const errors = []

    for await (const families of familyBatches(ctx!.organizationId)) {
      for (const family of families) {
        try {
          const existingStatement = await Statement.findOne({
            familyId: family._id,
            organizationId: ctx!.organizationId,
            fromDate: tolerantMsRange(fromDate),
            toDate: tolerantMsRange(toDate),
          })

          if (existingStatement) {
            const openingBalanceData = await calculateFamilyBalance(
              family._id.toString(),
              ctx!.organizationId,
              new Date(fromDate.getTime() - 1),
            )
            const openingBalance = openingBalanceData.balance
            const period = await loadStatementPeriod({
              organizationId: ctx!.organizationId,
              familyId: family._id.toString(),
              fromDate,
              toDate,
              openingBalance,
            })
            const refreshed = await Statement.findOneAndUpdate(
              { _id: existingStatement._id, organizationId: ctx!.organizationId, familyId: family._id },
              { $set: statementSnapshotFromPeriod(openingBalance, period) },
              { new: true },
            )
            generatedStatements.push({
              familyId: family._id.toString(),
              familyName: family.name,
              statementNumber: refreshed?.statementNumber ?? existingStatement.statementNumber,
              statement: refreshed ?? existingStatement,
              refreshed: true,
            })
            continue
          }

          const openingBalanceData = await calculateFamilyBalance(
            family._id.toString(),
            ctx!.organizationId,
            new Date(fromDate.getTime() - 1),
          )
          const openingBalance = openingBalanceData.balance

          const period = await loadStatementPeriod({
            organizationId: ctx!.organizationId,
            familyId: family._id.toString(),
            fromDate,
            toDate,
            openingBalance,
          })

          const seq = await nextCounter(
            `stmt:${ctx!.organizationId}:${family._id.toString()}`,
            async () =>
              Statement.countDocuments({
                familyId: family._id,
                organizationId: ctx!.organizationId,
              }),
          )
          const statementNumber = `STMT-${family._id.toString().slice(-6)}-${seq}`

          let statement
          try {
            statement = await Statement.create({
              familyId: family._id,
              organizationId: ctx!.organizationId,
              statementNumber,
              date: new Date(),
              fromDate: fromDate,
              toDate: toDate,
              ...statementSnapshotFromPeriod(openingBalance, period),
            })
          } catch (err: any) {
            if (err?.code === 11000) {
              const raced = await Statement.findOne({
                familyId: family._id,
                organizationId: ctx!.organizationId,
                fromDate: tolerantMsRange(fromDate),
                toDate: tolerantMsRange(toDate),
              })
              if (raced) {
                const refreshed = await Statement.findOneAndUpdate(
                  { _id: raced._id, organizationId: ctx!.organizationId, familyId: family._id },
                  { $set: statementSnapshotFromPeriod(openingBalance, period) },
                  { new: true },
                )
                generatedStatements.push({
                  familyId: family._id.toString(),
                  familyName: family.name,
                  statementNumber: refreshed?.statementNumber ?? raced.statementNumber,
                  statement: refreshed ?? raced,
                  refreshed: true,
                })
                continue
              }
            }
            throw err
          }

          generatedStatements.push({
            familyId: family._id.toString(),
            familyName: family.name,
            statementNumber: statement.statementNumber,
            statement: statement,
          })
        } catch (error: any) {
          errors.push({
            familyId: family._id.toString(),
            familyName: family.name,
            error: sanitizeStripeErrorMessage(error.message),
          })
        }
      }
    }

    return {
      status: 201,
      data: {
        success: true,
        month: targetMonth,
        year: targetYear,
        generated: generatedStatements.length,
        failed: errors.length,
        statements: generatedStatements,
        errors: sanitizeBatchErrors(errors.map((e) => `${e.familyName}: ${e.error}`)),
      },
    }
  },
})
