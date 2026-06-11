import { z } from 'zod'
import { email, isoDate, nonEmptyString, objectId, optionalString, trimmedName } from './common'

export const taskBody = z.object({
  title: trimmedName,
  description: optionalString(2000),
  dueDate: isoDate,
  email: z.string().trim().toLowerCase().email().max(254),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  relatedFamilyId: objectId.optional().nullable(),
  relatedMemberId: objectId.optional().nullable(),
  relatedPaymentId: objectId.optional().nullable(),
  notes: optionalString(2000),
})

export const taskUpdateBody = taskBody.partial().extend({
  completedAt: isoDate.optional().nullable(),
})
