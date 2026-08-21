import { describe, expect, it } from 'vitest'
import type { MessageKey } from '@/lib/i18n/load-locale'
import { automationRuleTypeLabel } from './automation-rule-type-label'

describe('automationRuleTypeLabel', () => {
  it('maps dunning_arrears to the dunning i18n key', () => {
    const seen: string[] = []
    const t = (key: MessageKey, fallback?: string) => {
      seen.push(key)
      return fallback ?? key
    }

    const label = automationRuleTypeLabel('dunning_arrears', t)

    expect(seen).toContain('communications.automations.ruleType.dunning')
    expect(label).toBe('Overdue balance (dunning)')
  })
})
