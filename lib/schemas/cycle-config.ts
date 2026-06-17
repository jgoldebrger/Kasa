import { z } from 'zod'
import { optionalString } from './common'

export const cycleConfigBody = z
  .object({
    cycleCalendar: z
      .string()
      .optional()
      .transform((v) => (v === 'hebrew' ? 'hebrew' : 'gregorian')),
    cycleStartMonth: z.coerce.number().int().min(1).max(12),
    cycleStartDay: z.coerce.number().int().min(1).max(31),
    cycleStartHebrewMonth: z.coerce.number().int().min(1).max(13).nullish(),
    cycleStartHebrewDay: z.coerce.number().int().min(1).max(30).nullish(),
    cycleAutoRollover: z.boolean().optional(),
    description: optionalString(500),
  })
  .superRefine((data, ctx) => {
    const calendar = data.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian'
    if (calendar === 'hebrew') {
      if (data.cycleStartHebrewMonth == null || data.cycleStartHebrewDay == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Hebrew month and day are required when using the Hebrew calendar',
          path: ['cycleStartHebrewMonth'],
        })
      }
    }
  })
