import { z } from 'zod'
import { moneyAmount, yearParam } from './common'

export const calculationQuery = z.object({
  year: yearParam.optional(),
})

export const calculationPostBody = z.object({
  year: yearParam,
  extraDonation: moneyAmount.optional().default(0),
  extraExpense: moneyAmount.optional().default(0),
})
