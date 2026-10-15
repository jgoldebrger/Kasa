import { z } from 'zod'
import { objectId } from './common'

export const emailAutomationRuleType = z.enum([
  'balance_gt_zero',
  'event_within_30_days',
  'dunning_arrears',
])

const baseFields = {
  name: z.string().min(1).max(200).trim(),
  enabled: z.boolean().optional(),
  templateId: objectId,
}

const balanceRule = z.object({
  ...baseFields,
  ruleType: z.literal('balance_gt_zero'),
})

const eventRule = z.object({
  ...baseFields,
  ruleType: z.literal('event_within_30_days'),
})

const dunningRule = z.object({
  ...baseFields,
  ruleType: z.literal('dunning_arrears'),
  minOwed: z.number().positive(),
  daysSinceObligation: z.number().int().min(1).max(3650).optional().default(30),
  maxAttempts: z.number().int().min(1).max(12).optional().default(3),
  intervalDays: z.number().int().min(1).max(90).optional().default(7),
})

export const emailAutomationRuleBody = z.discriminatedUnion('ruleType', [
  balanceRule,
  eventRule,
  dunningRule,
])

export const emailAutomationRuleUpdateBody = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    enabled: z.boolean().optional(),
    templateId: objectId.optional(),
    ruleType: emailAutomationRuleType.optional(),
    minOwed: z.number().positive().optional(),
    daysSinceObligation: z.number().int().min(1).max(3650).optional(),
    maxAttempts: z.number().int().min(1).max(12).optional(),
    intervalDays: z.number().int().min(1).max(90).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine((v) => (v.ruleType === 'dunning_arrears' ? v.minOwed != null : true), {
    message: 'minOwed is required when ruleType is dunning_arrears',
    path: ['minOwed'],
  })
