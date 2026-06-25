import { z } from 'zod'
import { objectId } from './common'

export const scheduledEmailBody = z.object({
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(100_000),
  text: z.string().max(100_000).optional(),
  familyIds: z.array(objectId).min(1).max(100),
  scheduledFor: z.coerce.date(),
})
