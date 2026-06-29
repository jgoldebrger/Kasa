import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  notificationKindCategory,
  shouldDeliverInAppNotification,
} from './notification-preferences'

describe('notificationKindCategory', () => {
  it('maps task kinds', () => {
    expect(notificationKindCategory('task-reminder')).toBe('tasks')
    expect(notificationKindCategory('task.due')).toBe('tasks')
  })

  it('maps payment kinds', () => {
    expect(notificationKindCategory('payment.failed')).toBe('payments')
    expect(notificationKindCategory('stripe.charge')).toBe('payments')
  })

  it('maps statement kinds', () => {
    expect(notificationKindCategory('statements')).toBe('statements')
    expect(notificationKindCategory('statement.ready')).toBe('statements')
  })

  it('returns null for uncategorized kinds', () => {
    expect(notificationKindCategory('system')).toBeNull()
  })
})

describe('shouldDeliverInAppNotification', () => {
  it('defaults to enabled when prefs omitted', () => {
    expect(shouldDeliverInAppNotification('task.due', undefined)).toBe(true)
  })

  it('respects disabled task preference', () => {
    expect(
      shouldDeliverInAppNotification('task.due', {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        tasks: false,
      }),
    ).toBe(false)
  })

  it('allows uncategorized kinds regardless of prefs', () => {
    expect(
      shouldDeliverInAppNotification('system', {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        tasks: false,
      }),
    ).toBe(true)
  })
})

describe('normalizeNotificationPreferences', () => {
  it('fills defaults for partial input', () => {
    expect(normalizeNotificationPreferences({ tasks: false })).toEqual({
      tasks: false,
      payments: true,
      statements: true,
    })
  })
})
