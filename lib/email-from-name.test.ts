import { describe, expect, it } from 'vitest'
import { sanitizeFromName } from './email-from-name'

describe('sanitizeFromName', () => {
  it('strips newlines and quotes', () => {
    expect(sanitizeFromName('Acme\n"Org"')).toBe('Acme Org')
  })

  it('caps length and defaults when empty', () => {
    expect(sanitizeFromName('  ')).toBe('Kasa Family Management')
    expect(sanitizeFromName('x'.repeat(200)).length).toBe(120)
  })
})
