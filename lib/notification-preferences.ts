/** Per-user in-app notification toggles (stored on User.preferences). */

export type NotificationPreferenceCategory = 'tasks' | 'payments' | 'statements'

export interface NotificationPreferences {
  tasks: boolean
  payments: boolean
  statements: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  tasks: true,
  payments: true,
  statements: true,
}

export function normalizeNotificationPreferences(
  raw: Partial<NotificationPreferences> | null | undefined,
): NotificationPreferences {
  return {
    tasks: raw?.tasks !== false,
    payments: raw?.payments !== false,
    statements: raw?.statements !== false,
  }
}

/** Map notification `kind` strings to a preference category, when applicable. */
export function notificationKindCategory(kind: string): NotificationPreferenceCategory | null {
  const k = kind.toLowerCase()
  if (k.startsWith('task') || k.includes('task.')) return 'tasks'
  if (k.startsWith('payment') || k.startsWith('stripe.') || k.includes('payment.')) {
    return 'payments'
  }
  if (k.startsWith('statement') || k === 'statements') return 'statements'
  return null
}

export function shouldDeliverInAppNotification(
  kind: string,
  prefs: Partial<NotificationPreferences> | null | undefined,
): boolean {
  const category = notificationKindCategory(kind)
  if (!category) return true
  const normalized = normalizeNotificationPreferences(prefs)
  return normalized[category]
}
