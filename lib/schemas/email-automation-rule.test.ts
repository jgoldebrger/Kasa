import { describe, expect, it } from 'vitest'
import { emailAutomationRuleBody, emailAutomationRuleUpdateBody } from './email-automation-rule'

const templateId = '507f1f77bcf86cd799439011'

describe('emailAutomationRuleBody', () => {
  it('rejects dunning_arrears without minOwed', () => {
    const parsed = emailAutomationRuleBody.safeParse({
      name: 'Overdue',
      templateId,
      ruleType: 'dunning_arrears',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts dunning_arrears with minOwed and fills defaults', () => {
    const parsed = emailAutomationRuleBody.parse({
      name: 'Overdue',
      templateId,
      ruleType: 'dunning_arrears',
      minOwed: 100,
    })
    expect(parsed.ruleType).toBe('dunning_arrears')
    if (parsed.ruleType === 'dunning_arrears') {
      expect(parsed.minOwed).toBe(100)
      expect(parsed.daysSinceObligation).toBe(30)
      expect(parsed.maxAttempts).toBe(3)
      expect(parsed.intervalDays).toBe(7)
    }
  })

  it('still accepts balance_gt_zero without dunning fields', () => {
    const parsed = emailAutomationRuleBody.parse({
      name: 'Balance',
      templateId,
      ruleType: 'balance_gt_zero',
    })
    expect(parsed.ruleType).toBe('balance_gt_zero')
  })
})

describe('emailAutomationRuleUpdateBody', () => {
  it('rejects empty patch', () => {
    expect(emailAutomationRuleUpdateBody.safeParse({}).success).toBe(false)
  })

  it('allows enabled-only patch', () => {
    expect(emailAutomationRuleUpdateBody.parse({ enabled: true })).toEqual({ enabled: true })
  })
})
