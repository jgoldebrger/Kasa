const TRANSPARENT_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export function trackingPixelDataUri(): string {
  return `data:image/gif;base64,${TRANSPARENT_GIF}`
}

export function buildOpenTrackingUrl(baseUrl: string, emailMessageId: string): string {
  const root = baseUrl.replace(/\/$/, '')
  return `${root}/api/email/track/open/${encodeURIComponent(emailMessageId)}`
}

export function buildClickTrackingUrl(
  baseUrl: string,
  emailMessageId: string,
  targetUrl: string,
): string {
  const root = baseUrl.replace(/\/$/, '')
  const encoded = Buffer.from(targetUrl, 'utf8').toString('base64url')
  return `${root}/api/email/track/click/${encodeURIComponent(emailMessageId)}?u=${encoded}`
}

export function decodeClickTarget(encoded: string): string | null {
  try {
    const url = Buffer.from(encoded, 'base64url').toString('utf8')
    if (!/^https?:\/\//i.test(url)) return null
    return url
  } catch {
    return null
  }
}

const HREF_RE = /<a\s+([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>/gi

/** Inject open pixel and rewrite http(s) links for click tracking. */
export function applyEmailTracking(
  html: string,
  opts: { emailMessageId: string; baseUrl: string; trackOpens: boolean; trackClicks: boolean },
): string {
  let out = html
  if (opts.trackClicks) {
    out = out.replace(HREF_RE, (match, before, quote, href, after) => {
      const trimmed = href.trim()
      if (!/^https?:\/\//i.test(trimmed)) return match
      if (trimmed.includes('/api/email/track/')) return match
      const tracked = buildClickTrackingUrl(opts.baseUrl, opts.emailMessageId, trimmed)
      return `<a ${before}href=${quote}${tracked}${quote}${after}>`
    })
  }
  if (opts.trackOpens) {
    const pixel = `<img src="${buildOpenTrackingUrl(opts.baseUrl, opts.emailMessageId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`
    if (/<body[^>]*>/i.test(out)) {
      out = out.replace(/<body([^>]*)>/i, `<body$1>${pixel}`)
    } else if (/<div[^>]*>/i.test(out)) {
      out = out.replace(/<div([^>]*)>/i, `<div$1>${pixel}`)
    } else {
      out = `${pixel}${out}`
    }
  }
  return out
}
