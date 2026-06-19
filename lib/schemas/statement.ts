import { z } from 'zod'

import { validateDateRange } from '@/lib/validate-date-range'

import { isoDate, moneyAmount, nonEmptyString, objectId, optionalString, yearParam } from './common'

const dateRangeRefine = [
  (d: { fromDate: Date; toDate: Date }) => d.fromDate.getTime() <= d.toDate.getTime(),

  { message: 'fromDate must be on or before toDate' },
] as const

const dateRangeSuperRefine = (d: { fromDate: Date; toDate: Date }, ctx: z.RefinementCtx) => {
  const err = validateDateRange(d.fromDate, d.toDate)

  if (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
  }
}

export const statementDateRangeBody = z

  .object({
    fromDate: isoDate,

    toDate: isoDate,
  })

  .refine(...dateRangeRefine)

  .superRefine(dateRangeSuperRefine)

export const statementSendEmailsBody = statementDateRangeBody

export const statementSendSingleEmailBody = z.object({
  statement: z.object({
    _id: objectId,
  }),
})

export const statementGenerateBody = z

  .object({
    familyId: objectId,

    fromDate: isoDate,

    toDate: isoDate,
  })

  .refine(...dateRangeRefine)

  .superRefine(dateRangeSuperRefine)

export const statementGenerateQuery = z.object({
  year: yearParam.optional(),

  month: z.coerce.number().int().min(1).max(12).optional(),
})

export const statementBody = z.object({
  familyId: objectId,

  statementNumber: nonEmptyString(80),

  date: isoDate,

  fromDate: isoDate,

  toDate: isoDate,

  openingBalance: z.number().finite(),

  income: moneyAmount,

  withdrawals: moneyAmount,

  expenses: moneyAmount,

  cycleCharges: moneyAmount.optional(),

  closingBalance: z.number().finite(),

  notes: optionalString(2000),
})

export const statementUpdateBody = statementBody.partial()
