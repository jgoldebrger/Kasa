import type { NextAuthConfig } from 'next-auth'
import { isCronRequest } from '@/lib/auth-cron-verify'

const PUBLIC_PATHS = [
  '/welcome',
  '/login',
  '/signup',
  '/invite',
  '/reset-password',
  '/request-invite',
  '/pricing',
  '/status',
  '/privacy',
  '/terms',
  '/subprocessors',
  '/manifest.webmanifest',
]

// Public APIs that don't require a session.
const PUBLIC_API_PREFIXES = [
  '/api/health',
  '/api/auth',
  '/api/auth/request-invite',
  // Stripe webhook is authenticated by HMAC signature (`stripe-signature`
  // header verified against `STRIPE_WEBHOOK_SECRET` inside the handler).
  // Stripe will never carry a session cookie; without this allow-list
  // entry refunds, disputes, and payment_failed events 401 silently and
  // never reach the handler.
  '/api/stripe/webhook',
  '/api/billing/plans',
  // Email open/click pixels and unsubscribe links are loaded by recipients'
  // mail clients without a session cookie.
  '/api/email/track',
  '/api/email/unsubscribe',
]

/** API routes that may bypass session auth when `CRON_SECRET` matches. Handlers re-verify. */
export const CRON_API_PREFIXES = [
  '/api/jobs',
  '/api/statements/auto-generate',
  '/api/statements/send-monthly-emails',
  '/api/statements/send-emails/worker',
  '/api/recurring-payments/process',
  '/api/tax-receipts/email/worker',
]

function isCronApiPath(path: string): boolean {
  return CRON_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

/**
 * Edge-safe NextAuth config used by middleware. Providers that require
 * Node APIs (Credentials with bcrypt + mongoose) live in app/auth.ts.
 */
export default {
  session: {
    strategy: 'jwt',
    // 7-day session (was 30d). Tightens the blast radius of a stolen
    // JWT or shared-device leak. With the sliding-window updateAge
    // below, active users renew their token in the background and
    // never see a forced logout; abandoned sessions die in a week.
    maxAge: 7 * 24 * 60 * 60,
    // Refresh the cookie/JWT iat at most once every 24h on user
    // activity. NextAuth recomputes the JWT in the session callback
    // when this threshold is crossed.
    updateAge: 24 * 60 * 60,
  },
  pages: {
    signIn: '/login',
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request
      const isLoggedIn = !!auth?.user
      const path = nextUrl.pathname

      // Public API endpoints
      if (PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
        return true
      }

      // Cron secret only bypasses session auth on explicitly allow-listed routes.
      // Invalid secrets fall through to the unauthenticated 401 below.
      if (isCronApiPath(path) && isCronRequest(request)) {
        return true
      }

      // Public pages
      if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
        if (
          isLoggedIn &&
          (path === '/login' ||
            path === '/signup' ||
            path === '/welcome' ||
            path === '/request-invite')
        ) {
          return Response.redirect(new URL('/', nextUrl))
        }
        return true
      }

      // Unauthenticated visitors hitting the protected app root land on the
      // marketing landing page rather than the bare login form. The login
      // page is still one click away.
      if (!isLoggedIn && path === '/') {
        return Response.redirect(new URL('/welcome', nextUrl))
      }

      if (isLoggedIn) return true

      // Unauthenticated. For API routes return a JSON 401 so fetch() callers
      // can handle it cleanly. For pages, let NextAuth do its default
      // redirect to the signIn page.
      if (path.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }

      return false
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      // Resolve platform-admin status from env at JWT-issue time. Cheap and
      // edge-safe because it doesn't hit the DB.
      const email = token.email || user?.email
      if (email) {
        const allowed = (process.env.PLATFORM_ADMIN_EMAILS || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
        token.isPlatformAdmin = allowed.includes(String(email).toLowerCase())
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id
      }
      if (session.user) {
        session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin)
      }
      return session
    },
  },
} satisfies NextAuthConfig
