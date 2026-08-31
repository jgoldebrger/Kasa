/** Indexable marketing, help, and legal surfaces. Authenticated app stays out. */
export const INDEXABLE_PATH_PREFIXES = [
  '/welcome',
  '/overview',
  '/help',
  '/pricing',
  '/trust',
  '/privacy',
  '/terms',
  '/dpa',
  '/subprocessors',
  '/status',
] as const

/** Unauthenticated visitors may load these (includes auth flows, not all indexable). */
export const AUTH_PUBLIC_PATH_PREFIXES = [
  ...INDEXABLE_PATH_PREFIXES,
  '/login',
  '/signup',
  '/invite',
  '/reset-password',
  '/request-invite',
  '/manifest.webmanifest',
  '/sitemap.xml',
  '/opengraph-image',
  '/twitter-image',
] as const

/** Private app prefixes crawlers must not fetch. `$` is Google's end-of-URL anchor for `/`. */
export const ROBOTS_DISALLOW_PATHS = [
  '/$',
  '/api/',
  '/admin/',
  '/families',
  '/dashboard',
  '/settings',
  '/payments',
  '/statements',
  '/communications',
  '/account',
  '/setup',
  '/invite',
  '/offline',
  '/reports',
  '/calendar',
  '/collections',
  '/tasks',
  '/events',
  '/projections',
  '/calculations',
  '/payment-plans',
  '/lifecycle-event-types',
  '/login',
  '/signup',
  '/reset-password',
  '/request-invite',
] as const

export const AI_CRAWLER_USER_AGENTS = [
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'ChatGPT-User',
  'PerplexityBot',
  'ClaudeBot',
  'anthropic-ai',
] as const

export function isAuthPublicPath(pathname: string): boolean {
  return AUTH_PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function isIndexablePath(pathname: string): boolean {
  return INDEXABLE_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
