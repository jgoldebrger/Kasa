import { NextResponse } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0
    const bc = i < b.length ? b.charCodeAt(i) : 0
    diff |= ac ^ bc
  }
  return diff === 0
}

function isNextAuthOwnedPath(pathname: string): boolean {
  const p = pathname
  if (p.includes('[...nextauth]') || p.includes('nextauth')) return true
  return (
    p === '/api/auth/signin' ||
    p.startsWith('/api/auth/signin/') ||
    p === '/api/auth/signout' ||
    p.startsWith('/api/auth/signout/') ||
    p.startsWith('/api/auth/callback/') ||
    p === '/api/auth/csrf' ||
    p === '/api/auth/session' ||
    p === '/api/auth/providers' ||
    p === '/api/auth/error'
  )
}

/**
 * Origin / Referer CSRF gate for state-changing API requests.
 * Mirrors middleware.ts so route handlers are protected even when
 * middleware is bypassed (e.g. some test/proxy setups).
 */
export function verifyApiCsrf(request: Request): NextResponse | null {
  if (SAFE_METHODS.has(request.method)) return null

  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return null
  if (isNextAuthOwnedPath(url.pathname)) return null
  if (url.pathname === '/api/stripe/webhook') return null

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const headerSecret = request.headers.get('x-cron-secret')
    if (headerSecret && safeEqual(headerSecret, cronSecret)) return null
    const authz = request.headers.get('authorization')
    if (authz?.startsWith('Bearer ')) {
      const token = authz.slice(7).trim()
      if (token && safeEqual(token, cronSecret)) return null
    }
  }

  const host = request.headers.get('host')
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  if (origin) {
    try {
      const o = new URL(origin)
      if (host && o.host === host) return null
    } catch {
      // malformed
    }
    return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
  }

  if (referer) {
    try {
      const r = new URL(referer)
      if (host && r.host === host) return null
    } catch {
      // ignored
    }
    return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
  }

  return NextResponse.json({ error: 'Missing Origin / Referer header' }, { status: 403 })
}
