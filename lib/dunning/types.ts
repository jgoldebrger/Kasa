export type EmailAutomationRuleType = 'balance_gt_zero' | 'event_within_30_days' | 'dunning_arrears'

export type DunningEpisodeStatus = 'open' | 'closed'

export type DunningClosedReason = 'payment' | 'max_attempts' | 'no_longer_qualifies'
