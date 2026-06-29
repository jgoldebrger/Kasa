import { z } from 'zod'
import { email, optionalTrimmedString } from './common'

export const emailConfigBody = z.object({
  email,
  password: z.string().min(1).max(200).optional(),
  fromName: optionalTrimmedString(200),
  replyTo: email.optional().or(z.literal('')),
  emailStrictDeliverability: z.boolean().optional(),
})

export const emailSettingsPatchBody = z.object({
  emailStrictDeliverability: z.boolean(),
})
