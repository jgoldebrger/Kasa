/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  snoozeAttentionForDays,
  isAttentionItemHidden,
  clearAttentionSnooze,
} from './attention-snooze'

describe('attention-snooze', () => {
  const orgId = 'org-test-1'
  const key = 'delinquentFamilies' as const

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('is hidden while snooze date is in the future', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    snoozeAttentionForDays(orgId, key, 7, now)
    expect(isAttentionItemHidden(orgId, key, new Date('2026-06-05T00:00:00.000Z'))).toBe(true)
    expect(isAttentionItemHidden(orgId, key, new Date('2026-06-10T00:00:00.000Z'))).toBe(false)
  })

  it('clearAttentionSnooze removes snooze', () => {
    snoozeAttentionForDays(orgId, key, 30)
    clearAttentionSnooze(orgId, key)
    expect(isAttentionItemHidden(orgId, key)).toBe(false)
  })
})
