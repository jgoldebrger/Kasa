import { z } from 'zod'
import { objectId } from './common'

export const sendEmailBody = z.object({
  familyId: objectId.optional(),
  to: z.string().email().optional(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(100_000),
  text: z.string().max(100_000).optional(),
  transactional: z.boolean().optional(),
})

export const sendBulkEmailBody = z.object({
  familyIds: z.array(objectId).min(1).max(100),
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(100_000),
  text: z.string().max(100_000).optional(),
  transactional: z.boolean().optional(),
})

export const listEmailsQuery = z.object({
  familyId: objectId.optional(),
  kind: z.enum(['custom', 'statement', 'tax-receipt', 'task-reminder', 'file']).optional(),
  status: z.enum(['queued', 'sent', 'opened', 'clicked', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})
