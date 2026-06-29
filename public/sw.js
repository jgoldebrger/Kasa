/* eslint-disable no-restricted-globals */
/**
 * Kasa service worker.
 *
 * Strategy:
 *   - Pre-cache an app shell (offline page + manifest + favicon) on install
 *   - Network-first for HTML navigations with a fall-back to the cached
 *     offline shell when the network is down — so the user gets *some*
 *     page rather than the browser's stock error
 *   - Stale-while-revalidate for `/api/families`, `/api/payments`,
 *     `/api/statements` GETs — these are read-heavy and OK to serve a
 *     few-minute-old copy while we re-fetch in the background
 *   - Cache-first with revalidation for static `/_next/static/*` assets
 *   - Never touch POST/PATCH/DELETE — pass them straight through. Offline
 *     mutation queueing is handled in-app (IndexedDB + reconnect sync in
 *     lib/client/offline-write-queue) for a small set of safe updates;
 *     the SW does not replay writes.
 *
 * Versioning: bump `CACHE_VERSION` on any worker logic change so old
 * caches are flushed on the next activate.
 */

const CACHE_VERSION = 'kasa-v1'
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const API_CACHE = `${CACHE_VERSION}-api`
const STATIC_CACHE = `${CACHE_VERSION}-static`

// Anything we want guaranteed available when fully offline.
const SHELL_URLS = ['/offline', '/manifest.webmanifest', '/favicon.ico']

// API GET endpoints we'll stale-while-revalidate.
//
// IMPORTANT: every endpoint here is tenant-scoped, and the SW cache
// key is the request URL alone. That means immediately after a user
// switches orgs (and before `CLEAR_ORG_CACHES` fires) a re-render
// could SWR the *previous* org's response back to the new context —
// a cross-tenant data leak.
//
// We've stripped this list down to empty so the SW NEVER serves
// tenant data from cache. Static assets and the offline shell still
// benefit from caching; everything tenant-scoped goes straight to
// the network (the React Query layer in-app already handles its
// own per-tab caching with org-aware invalidation). If/when we
// want SWR back, the cache key must be salted with the active org
// id (e.g. read from a cookie and prefixed onto `cache.put`/`match`).
const CACHEABLE_API_PREFIXES = []

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // `addAll` is atomic — if any URL 404s the whole install fails.
      // Treat shell URLs as best-effort instead so a missing /offline
      // doesn't permanently break installs in dev.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache
            .add(new Request(url, { cache: 'no-cache' }))
            .catch(() => {}),
        ),
      )
      self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any cache that doesn't belong to this version.
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.origin && event.origin !== self.location.origin) return
  const type = event.data?.type
  // The page can tell us to skip waiting after the user clicks "reload"
  // in our update toast. Wired up from app/components/PwaInit.tsx.
  if (type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  // The active org changed — drop any tenant-scoped API responses so we
  // don't briefly serve the previous org's data to the new one. Dispatched
  // from OrgSwitcher right before the user lands on the new org. Shell +
  // static caches stay; only API caches are tenant-sensitive.
  if (type === 'CLEAR_ORG_CACHES') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter((k) => k === API_CACHE)
            .map((k) => caches.delete(k)),
        )
      })(),
    )
  }
})

function isCacheableApi(url) {
  if (url.origin !== self.location.origin) return false
  return CACHEABLE_API_PREFIXES.some((p) => url.pathname.startsWith(p))
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    // Only cache successful responses. Skip opaque + redirect.
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl)
      if (fallback) return fallback
    }
    throw err
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {})
      }
      return response
    })
    .catch(() => cached)
  return cached || fetchPromise
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Same-origin only — we never want to intercept third-party calls
  // (Stripe, fonts, etc).
  if (url.origin !== self.location.origin) return

  // Sentry / NextAuth / Stripe webhook — anything sensitive — never
  // gets cached. NextAuth in particular embeds CSRF + JWT state that
  // would be a disaster to serve from cache.
  if (url.pathname.startsWith('/api/auth/')) return
  if (url.pathname.startsWith('/api/stripe/')) return

  // Page navigations: network-first, fall back to /offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/offline'))
    return
  }

  // Cacheable API endpoints: SWR so the user sees data instantly.
  if (isCacheableApi(url)) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE))
    return
  }

  // Static assets shipped by Next: hashed paths, immutable — cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }
})
