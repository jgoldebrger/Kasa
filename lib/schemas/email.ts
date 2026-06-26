import { z } from 'zod'
import { objectId } from './common'

const emailAttachment = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1).max(10_000_000),
  contentType: z.string().max(200).optional(),
})

export const sendEmailBody = z.object({
  familyId: objectId.optional(),
  to: z.string().email().optional(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(100_000),
  text: z.string().max(100_000).optional(),
  transactional: z.boolean().optional(),
  attachments: z.array(emailAttachment).max(10).optional(),
})

export const sendBulkEmailBody = z.object({
  familyIds: z.array(objectId).min(1).max(100),
  subject: z.string().min(1).max(998),
  subjectB: z.string().min(1).max(998).optional(),
  html: z.string().min(1).max(100_000),
  text: z.string().max(100_000).optional(),
  transactional: z.boolean().optional(),
  attachments: z.array(emailAttachment).max(10).optional(),
})

export const sendBulkEmailQuery = z.object({
  async: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export const listEmailsQuery = z.object({
  familyId: objectId.optional(),
  kind: z.enum(['custom', 'statement', 'tax-receipt', 'task-reminder', 'file']).optional(),
  status: z.enum(['queued', 'sent', 'opened', 'clicked', 'failed']).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  format: z.enum(['csv']).optional(),
})

export const attachStatementBody = z.object({
  familyId: objectId,
  statementId: objectId.optional(),
})
