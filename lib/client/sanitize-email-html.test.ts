import { describe, expect, it } from 'vitest'
import { isSafeEmailHref, sanitizeEmailHtml } from './sanitize-email-html'

describe('sanitizeEmailHtml', () => {
  it('strips script tags on the server path', () => {
    const out = sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>')
    expect(out).toContain('<p>Hi</p>')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('removes javascript: links', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain('javascript:')
  })

  it('removes data: href links', () => {
    const out = sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')
    expect(out.toLowerCase()).not.toContain('data:')
  })

  it('strips iframe elements', () => {
    const out = sanitizeEmailHtml('<p>Hi</p><iframe src="https://evil.com"></iframe>')
    expect(out.toLowerCase()).not.toContain('<iframe')
  })

  it('keeps safe https links', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com">link</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('strips event handler attributes', () => {
    const out = sanitizeEmailHtml('<p onclick="alert(1)">x</p>')
    expect(out.toLowerCase()).not.toContain('onclick')
  })
})

describe('isSafeEmailHref', () => {
  it('allows http(s) and mailto only', () => {
    expect(isSafeEmailHref('https://a.com')).toBe(true)
    expect(isSafeEmailHref('mailto:a@b.com')).toBe(true)
    expect(isSafeEmailHref('javascript:alert(1)')).toBe(false)
    expect(isSafeEmailHref('data:text/html,hi')).toBe(false)
  })
})
