/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'kasa:client-cache:v1'

describe('client-cache (dom)', () => {
  beforeEach(async () => {
    vi.resetModules()
    sessionStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ url, n: 1 }),
      })),
    )
    const mod = await import('./client-cache')
    mod.clearCache()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    const mod = await import('./client-cache')
    mod.clearCache()
    sessionStorage.clear()
  })

  async function loadCache() {
    return import('./client-cache')
  }

  it('returns cached GET responses within TTL', async () => {
    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const a = await cachedFetch<{ url: string }>('/api/tasks')
    const b = await cachedFetch<{ url: string }>('/api/tasks')
    expect(a).toEqual(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent in-flight requests', async () => {
    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const [a, b] = await Promise.all([
      cachedFetch('/api/x'),
      cachedFetch('/api/x'),
    ])
    expect(a).toEqual(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache when ttl is 0', async () => {
    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    await cachedFetch('/api/y', { ttl: 0 })
    await cachedFetch('/api/y', { ttl: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('invalidate forces a refetch for the removed key only', async () => {
    const { cachedFetch, invalidate } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    await cachedFetch('/api/a')
    await cachedFetch('/api/b')
    invalidate('/api/a')
    await cachedFetch('/api/a')
    await cachedFetch('/api/b')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('clearCache dispatches kasa:client-cache-cleared', async () => {
    const { clearCache } = await loadCache()
    const handler = vi.fn()
    window.addEventListener('kasa:client-cache-cleared', handler)
    clearCache()
    expect(handler).toHaveBeenCalled()
    window.removeEventListener('kasa:client-cache-cleared', handler)
  })

  it('hydrates fresh entries from sessionStorage on first fetch', async () => {
    const now = Date.now()
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        '/api/hydrated': {
          data: { warm: true },
          fetchedAt: now,
          ttl: 60_000,
        },
      }),
    )

    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    const data = await cachedFetch<{ warm: boolean }>('/api/hydrated')
    expect(data).toEqual({ warm: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores corrupt sessionStorage and still fetches', async () => {
    sessionStorage.setItem(STORAGE_KEY, '{not-json')

    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    const data = await cachedFetch('/api/recover')
    expect(data).toEqual({ url: '/api/recover', n: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('persists cache to sessionStorage after the flush debounce', async () => {
    vi.useFakeTimers()
    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    await cachedFetch('/api/persist-me')
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()

    await vi.advanceTimersByTimeAsync(150)

    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
    expect(stored['/api/persist-me']).toMatchObject({
      data: { url: '/api/persist-me', n: 1 },
      ttl: 30_000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache non-GET requests', async () => {
    const { cachedFetch } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    await cachedFetch('/api/mutate', { method: 'POST', body: '{}' })
    await cachedFetch('/api/mutate', { method: 'POST', body: '{}' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws when fetch returns a non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    )
    const { cachedFetch } = await loadCache()
    await expect(cachedFetch('/api/fail')).rejects.toThrow('HTTP 503')
  })

  it('skips persisting entries when JSON.stringify throws', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ bad: BigInt(1) }),
      })),
    )
    const { cachedFetch } = await loadCache()
    await cachedFetch('/api/bigint')
    await vi.advanceTimersByTimeAsync(150)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('invalidate with a regex removes matching inflight keys', async () => {
    let resolveFetch!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveFetch = resolve
    })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    const { cachedFetch, invalidate } = await loadCache()
    const inFlight = cachedFetch('/api/tasks/queued')
    invalidate(/^\/api\/tasks/)
    resolveFetch({ ok: true, json: async () => ({ done: true }) })
    await expect(inFlight).resolves.toEqual({ done: true })
  })

  it('invalidate with a regex removes matching keys', async () => {
    const { cachedFetch, invalidate } = await loadCache()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    await cachedFetch('/api/tasks/1')
    await cachedFetch('/api/tasks/2')
    await cachedFetch('/api/other')

    invalidate(/^\/api\/tasks/)

    await cachedFetch('/api/tasks/1')
    await cachedFetch('/api/other')

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
