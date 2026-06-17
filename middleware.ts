import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import authConfig from './app/auth.config'
import { verifyApiCsrf } from '@/lib/csrf'

export const { auth: middleware } = NextAuth(authConfig)

const IS_PROD = process.env.NODE_ENV === 'production'

/**
 * Build a strict Content-Security-Policy for production. We use the
 * `nonce + 'strict-dynamic'` pattern so Next.js's own bootstrap script
 * (which gets the nonce when it sees the `x-nonce` request header) can
 * load all subsequent chunks without us having to enumerate them.
 *
 * Dev (HMR) and Turbopack rely on un-nonced inline scripts, so we skip
 * CSP entirely in dev to avoid breaking the editor experience.
 */
function buildCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    // 'strict-dynamic' means: any script we trust (via nonce) is
    // allowed to load further scripts. Browsers that honour it ignore
    // 'self' / host allow-lists in script-src, which is the secure
    // modern behaviour. Older browsers fall back to 'self' + the
    // explicit Stripe host below.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com`,
    // Tailwind compiles to CSS files; inline <style> is rare but Next
    // injects a few small ones, so 'unsafe-inline' is the practical
    // choice without breaking the app. Tightening this further would
    // require migrating any remaining inline styles.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    // Sentry client + Web Vitals beacons (see sentry.*.config.ts DSN ingest hosts).
    `connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io`,
    `frame-src https://js.stripe.com https://hooks.stripe.com`,
    // Lock everything else down.
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ]
  return directives.join('; ')
}

/**
 * Edge-safe nonce: 16 random bytes, base64-encoded. Web Crypto is
 * available in the Edge runtime so we don't need node:crypto.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export default middleware((req) => {
  const csrf = verifyApiCsrf(req)
  if (csrf) return csrf

  // CSP with per-request nonce. Only enabled in production — dev/HMR
  // emits non-nonced inline scripts that would all be blocked.
  // We attach the nonce to a request header so server components /
  // Next.js itself can apply it to any inline <script> they emit, and
  // also stamp the CSP header on the response.
  //
  // Path check uses `nextUrl.pathname` rather than the full URL string
  // because a benign page URL like `/?ref=/api/foo` would otherwise
  // suppress the CSP via a false-positive substring match on `/api/`.
  const pathname = req.nextUrl.pathname
  if (IS_PROD && !pathname.startsWith('/api/')) {
    const nonce = generateNonce()
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-nonce', nonce)

    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set('Content-Security-Policy', buildCsp(nonce))
    return res
  }

  // The `authorized` callback in auth.config handles auth redirects.
  return undefined as any
})

export const config = {
  matcher: [
    // Match everything except Next.js internals, static assets, and favicon.
    // The authorized() callback in auth.config decides which paths require auth.
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
