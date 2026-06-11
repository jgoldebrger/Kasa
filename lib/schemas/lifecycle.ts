import { z } from 'zod'
import { isoDate, moneyAmount, optionalString, trimmedName, yearParam } from './common'

/** Lowercase slug key for lifecycle event types (e.g. `bar_mitzvah`). */
export const eventTypeKey = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Type key required')
  .max(60)
  .regex(/^[a-z0-9_-]+$/, 'Invalid event type key')

export const lifecycleEventTypeBody = z.object({
  type: eventTypeKey,
  name: trimmedName,
  amount: moneyAmount,
})

export const lifecycleEventTypeUpdateBody = z
  .object({
    name: trimmedName.optional(),
    amount: moneyAmount.optional(),
  })
  .refine((d) => d.name !== undefined || d.amount !== undefined, {
    message: 'Nothing to update.',
  })

export const lifecycleEventPaymentBody = z.object({
  eventType: z.string().trim().min(1).max(60),
  amount: moneyAmount.optional(),
  eventDate: isoDate,
  year: yearParam,
  notes: optionalString(2000),
})
