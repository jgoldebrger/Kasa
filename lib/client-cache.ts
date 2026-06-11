/**
 * Tiny in-memory client-side fetch cache with in-flight request dedupe.
 *
 * Why this exists:
 *   - Each page typically fetches its own data in useEffect. When the
 *     user navigates A → B → A, page A re-fetches even though nothing
 *     changed.
 *   - Two components on the same page that fetch the same URL fire two
 *     identical requests. This deduplicates them.
 *   - Hard reloads previously dropped every entry; we now mirror the
 *     cache into sessionStorage so a refresh starts with warm data.
 *
 * Usage:
 *   const data = await cachedFetch<MyType>('/api/tasks')
 *   await cachedFetch('/api/tasks', { ttl: 10_000 })
 *   invalidate('/api/tasks')           // exact
 *   invalidate(/^\/api\/tasks/)        // prefix
 *
 * Notes:
 *   - GET only. Mutations always go through plain fetch().
 *   - Cache is per-tab (in-memory + sessionStorage). Survives client-side
 *     navigations AND full page reloads within the same tab.
 *   - Pages that need real-time data should pass { ttl: 0 } or call
 *     invalidate(url) before re-fetching.
 */

const DEFAULT_TTL_MS = 30_000
const STORAGE_KEY = 'kasa:client-cache:v1'
// Don't try to mirror responses larger than this into sessionStorage —
// browsers cap session storage around 5 MB, and a single bloated entry
// shouldn't poison the rest of the cache.
const PERSIST_MAX_BYTES = 256 * 1024

type Entry = {
  data: unknown
  fetchedAt: number
  ttl: number
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

// Hydrate from sessionStorage on first import (browser only).
let hydrated = false
function hydrateFromStorage(): void {
  if (hydrated) return
  hydrated = true
  if (typeof window === 'undefined') return
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const obj = JSON.parse(raw) as Record<string, Entry>
    const now = Date.now()
    for (const [k, v] of Object.entries(obj)) {
      // Drop anything already stale at boot — saves us from serving very
      // old data after a long idle tab is re-opened.
      if (v && typeof v.fetchedAt === 'number' && now - v.fetchedAt < v.ttl) {
        cache.set(k, v)
      }
    }
  } catch {
    // Corrupt JSON / disabled storage — start clean.
  }
}

// Debounced flush back to sessionStorage to keep the (cheap) write off the
// hot path. We coalesce writes within a short window so a burst of fetches
// only writes once.
let flushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFlush(): void {
  if (typeof window === 'undefined') return
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      const out: Record<string, Entry> = {}
      for (const [k, v] of cache.entries()) {
        // Don't persist huge entries that would blow the storage quota.
        try {
          const size = JSON.stringify(v.data).length
          if (size > PERSIST_MAX_BYTES) continue
        } catch {
          continue
        }
        out[k] = v
      }
      if (Object.keys(out).length === 0) {
        window.sessionStorage.removeItem(STORAGE_KEY)
      } else {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(out))
      }
    } catch {
      // Quota exceeded / disabled storage — drop the snapshot silently.
    }
  }, 150)
}

export interface CachedFetchOptions extends RequestInit {
  /** Cache freshness window in ms. Default 30s. Set 0 to force-bypass cache. */
  ttl?: number
  /** Skip the cache and force a network round-trip; still updates cache on success. */
  bypass?: boolean
}

function isFresh(entry: Entry): boolean {
  return Date.now() - entry.fetchedAt < entry.ttl
}

export async function cachedFetch<T = unknown>(url: string, opts: CachedFetchOptions = {}): Promise<T> {
  hydrateFromStorage()
  const { ttl = DEFAULT_TTL_MS, bypass = false, ...init } = opts

  // Anything but a GET (default) should not be cached. Caller almost
  // certainly wants to invalidate after.
  if (init.method && init.method.toUpperCase() !== 'GET') {
    const res = await fetch(url, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  if (!bypass && ttl > 0) {
    const cached = cache.get(url)
    if (cached && isFresh(cached)) {
      return cached.data as T
    }
  }

  // Dedupe concurrent requests to the same URL.
  if (inflight.has(url)) {
    return inflight.get(url) as Promise<T>
  }

  const promise = (async () => {
    try {
      const res = await fetch(url, init)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      if (ttl > 0) {
        cache.set(url, { data, fetchedAt: Date.now(), ttl })
        scheduleFlush()
      }
      return data
    } finally {
      inflight.delete(url)
    }
  })()

  inflight.set(url, promise)
  return promise as Promise<T>
}

export function invalidate(target: string | RegExp): void {
  if (typeof target === 'string') {
    cache.delete(target)
    inflight.delete(target)
    scheduleFlush()
    return
  }
  for (const key of Array.from(cache.keys())) {
    if (target.test(key)) cache.delete(key)
  }
  for (const key of Array.from(inflight.keys())) {
    if (target.test(key)) inflight.delete(key)
  }
  scheduleFlush()
}

export function clearCache(): void {
  cache.clear()
  inflight.clear()
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore — storage disabled
    }
    // Broadcast so caches that live outside this module (e.g. the per-user
    // column-visibility snapshot in `useColumnVisibility`) can drop their
    // state too. Fired on sign-out / org switch.
    try {
      window.dispatchEvent(new CustomEvent('kasa:client-cache-cleared'))
    } catch {
      // ignore
    }
  }
}
