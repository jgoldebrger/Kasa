import { z } from 'zod'
import { objectId } from './common'

export const emailAutomationRuleType = z.enum(['balance_gt_zero', 'event_within_30_days'])

export const emailAutomationRuleBody = z.object({
  name: z.string().min(1).max(200).trim(),
  enabled: z.boolean().optional(),
  templateId: objectId,
  ruleType: emailAutomationRuleType,
})

export const emailAutomationRuleUpdateBody = emailAutomationRuleBody
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
