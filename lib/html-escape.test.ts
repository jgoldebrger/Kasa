import { describe, expect, it } from 'vitest'
import { escapeHtml } from './html-escape'

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<script>"\'&</script>')).toBe(
      '&lt;script&gt;&quot;&#39;&amp;&lt;/script&gt;',
    )
  })

  it('returns empty string for nullish input', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})
