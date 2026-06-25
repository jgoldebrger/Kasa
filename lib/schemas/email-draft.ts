import { z } from 'zod'
import { objectId, optionalTrimmedString } from './common'

export const emailDraftBody = z.object({
  subject: optionalTrimmedString(998).optional(),
  body: z.string().max(100_000).optional(),
  html: z.string().max(100_000).optional(),
  selectedFamilyIds: z.array(objectId).max(500).optional(),
})

export const emailDraftUpdateBody = emailDraftBody.refine((v) => Object.keys(v).length > 0, {
  message: 'At least one field is required',
})
