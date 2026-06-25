import { z } from 'zod'
import { objectId, optionalTrimmedString } from './common'

export const emailTemplateBody = z.object({
  name: z.string().min(1).max(200).trim(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(100_000),
  text: z.string().max(100_000).optional(),
})

export const emailTemplateUpdateBody = emailTemplateBody
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
