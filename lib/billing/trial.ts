/** Org fields used to decide if a first-time checkout should include a trial. */
export interface TrialEligibilitySnapshot {
  subscriptionId?: string | null
  subscriptionStatus?: string | null
}

/**
 * Free-trial length for new platform subscriptions (days).
 * Set `STRIPE_SUBSCRIPTION_TRIAL_DAYS=0` to disable. Unset = no trial.
 */
export function getSubscriptionTrialDays(): number {
  const raw = process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS?.trim()
  if (!raw) return 0
  const days = Number.parseInt(raw, 10)
  if (!Number.isFinite(days) || days < 0) return 0
  return days
}

/** True when this org has never held a platform subscription and may start a trial. */
export function isSubscriptionTrialEligible(org: TrialEligibilitySnapshot): boolean {
  if (org.subscriptionId?.trim()) return false
  const status = org.subscriptionStatus?.trim()
  if (status) return false
  return true
}

export function resolveCheckoutTrialDays(org: TrialEligibilitySnapshot): number | undefined {
  const days = getSubscriptionTrialDays()
  if (days <= 0) return undefined
  if (!isSubscriptionTrialEligible(org)) return undefined
  return days
}
