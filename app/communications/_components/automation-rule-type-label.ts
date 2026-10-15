import type { MessageKey } from '@/lib/i18n/load-locale'
import type { EmailAutomationRuleRow } from './types'

export function automationRuleTypeLabel(
  ruleType: EmailAutomationRuleRow['ruleType'],
  t: (key: MessageKey, fallback?: string) => string,
): string {
  if (ruleType === 'balance_gt_zero') {
    return t('communications.automations.ruleType.balance', 'Balance greater than zero')
  }
  if (ruleType === 'event_within_30_days') {
    return t('communications.automations.ruleType.event', 'Lifecycle event within 30 days')
  }
  return t('communications.automations.ruleType.dunning', 'Overdue balance (dunning)')
}
