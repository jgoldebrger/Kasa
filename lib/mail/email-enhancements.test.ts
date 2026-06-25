import { describe, expect, it, vi, beforeEach } from 'vitest'
import { normalizeGmailAppPassword } from './normalize-app-password'
import { applyMergeFields } from './merge-fields'
import { delayBetweenSendsMs } from './send-pacing'
import { getDailySendLimit } from './daily-send-quota'

describe('normalizeGmailAppPassword', () => {
  it('strips whitespace', () => {
    expect(normalizeGmailAppPassword('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop')
  })
})

describe('applyMergeFields', () => {
  it('replaces merge tokens', () => {
    const out = applyMergeFields(
      'Hi {{familyName}}, balance {{balance}}, dues {{dues}}, plan {{planName}}, event {{eventDate}}, due {{nextDue}}',
      {
        familyName: 'Cohen',
        balance: 100,
        dues: 500,
        planName: 'Standard',
        eventDate: 'June 1, 2026',
        nextDue: 'September 1, 2026',
      },
    )
    expect(out).toContain('Cohen')
    expect(out).toContain('$100.00')
    expect(out).toContain('$500.00')
    expect(out).toContain('Standard')
    expect(out).toContain('June 1, 2026')
    expect(out).toContain('September 1, 2026')
  })
})

describe('delayBetweenSendsMs', () => {
  it('returns delay for large bulk sends', () => {
    expect(delayBetweenSendsMs(5)).toBe(0)
    expect(delayBetweenSendsMs(11)).toBe(200)
  })
})

describe('getDailySendLimit', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to 450 when env unset', () => {
    delete process.env.GMAIL_DAILY_LIMIT
    expect(getDailySendLimit()).toBe(450)
  })

  it('reads GMAIL_DAILY_LIMIT from env', () => {
    vi.stubEnv('GMAIL_DAILY_LIMIT', '200')
    expect(getDailySendLimit()).toBe(200)
  })

  it('falls back to 450 for invalid env', () => {
    vi.stubEnv('GMAIL_DAILY_LIMIT', 'not-a-number')
    expect(getDailySendLimit()).toBe(450)
  })
})
