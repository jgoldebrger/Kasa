import { describe, expect, it } from 'vitest'
import { normalizeGmailAppPassword } from './normalize-app-password'
import { applyMergeFields } from './merge-fields'
import { delayBetweenSendsMs } from './send-pacing'

describe('normalizeGmailAppPassword', () => {
  it('strips whitespace', () => {
    expect(normalizeGmailAppPassword('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop')
  })
})

describe('applyMergeFields', () => {
  it('replaces merge tokens', () => {
    const out = applyMergeFields('Hi {{familyName}}, balance {{balance}}, dues {{dues}}', {
      familyName: 'Cohen',
      balance: 100,
      dues: 500,
    })
    expect(out).toContain('Cohen')
    expect(out).toContain('$100.00')
    expect(out).toContain('$500.00')
  })
})

describe('delayBetweenSendsMs', () => {
  it('returns delay for large bulk sends', () => {
    expect(delayBetweenSendsMs(5)).toBe(0)
    expect(delayBetweenSendsMs(11)).toBe(200)
  })
})
