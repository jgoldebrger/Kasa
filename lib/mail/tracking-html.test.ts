import { describe, it, expect } from 'vitest'
import { applyEmailTracking, decodeClickTarget } from './tracking-html'

describe('applyEmailTracking', () => {
  it('injects open pixel before closing body', () => {
    const html = '<html><body><p>Hi</p></body></html>'
    const out = applyEmailTracking(html, {
      emailMessageId: 'abc123',
      baseUrl: 'https://app.example.com',
      trackOpens: true,
      trackClicks: false,
    })
    expect(out).toContain('/api/email/track/open/abc123')
    expect(out).toContain('</body>')
  })

  it('rewrites http links for click tracking', () => {
    const html = '<a href="https://example.com/page">link</a>'
    const out = applyEmailTracking(html, {
      emailMessageId: 'msg1',
      baseUrl: 'https://app.example.com',
      trackOpens: false,
      trackClicks: true,
    })
    expect(out).toContain('/api/email/track/click/msg1')
    expect(out).not.toContain('href="https://example.com/page"')
  })
})

describe('decodeClickTarget', () => {
  it('decodes valid https URLs', () => {
    const encoded = Buffer.from('https://example.com/x', 'utf8').toString('base64url')
    expect(decodeClickTarget(encoded)).toBe('https://example.com/x')
  })

  it('rejects non-http URLs', () => {
    const encoded = Buffer.from('javascript:alert(1)', 'utf8').toString('base64url')
    expect(decodeClickTarget(encoded)).toBeNull()
  })
})
