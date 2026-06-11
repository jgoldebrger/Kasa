import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const upstashMocks = vi.hoisted(() => ({
  limit: vi.fn(async () => ({
    success: true,
    remaining: 4,
    reset: Date.now() + 60_000,
  })),
}))

vi.mock('@upstash/ratelimit', () => {
  class MockRatelimit {
    limit = upstashMocks.limit
    constructor(_opts?: unknown) {}
    static fixedWindow(limit: number, window: string) {
      return { limit, window }
    }
  }
  return { Ratelimit: MockRatelimit }
})

vi.mock('@upstash/redis', () => ({
  Redis: {
    fromEnv: vi.fn(() => ({})),
  },
}))

const rlMocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  leanResult: null as {
    count: number
    expiresAt: Date
    windowStart: Date
  } | null,
  findOneAndUpdate: vi.fn(),
}))

vi.mock('@/lib/database', () => ({ default: rlMocks.connectDB }))

vi.mock('mongoose', () => {
  const chain = {
    lean: () => Promise.resolve(rlMocks.leanResult),
  }
  rlMocks.findOneAndUpdate.mockReturnValue(chain)
  const RateLimitModel = { findOneAndUpdate: rlMocks.findOneAndUpdate }
  return {
    default: {
      models: { RateLimit: RateLimitModel },
      model: vi.fn(() => RateLimitModel),
    },
    Schema: vi.fn(function Schema() {
      return {}
    }),
  }
})

async function importCheckRateLimit() {
  vi.resetModules()
  const mod = await import('./rate-limit')
  return mod.checkRateLimit
}

function reqWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://localhost/test', { headers })
}

describe('checkRateLimit (unit, mocked Mongo)', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    rlMocks.leanResult = {
      count: 1,
      windowStart: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    rlMocks.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve(rlMocks.leanResult),
    })
  })

  afterEach(() => {
    process.env = { ...envBackup }
    vi.unstubAllEnvs()
  })

  it('uses the first x-forwarded-for address when TRUST_PROXY is set', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    const check = await importCheckRateLimit()
    await check(reqWithHeaders({ 'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2 ' }), 'api', {
      limit: 5,
      windowMs: 60_000,
    })
    expect(rlMocks.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.stringContaining('10.0.0.1') }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('falls back to x-real-ip then cf-connecting-ip', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    const check = await importCheckRateLimit()
    await check(reqWithHeaders({ 'x-real-ip': '203.0.113.5' }), 'api', {
      limit: 5,
      windowMs: 60_000,
    })
    expect(rlMocks.findOneAndUpdate.mock.calls[0][0]._id).toContain('203.0.113.5')

    rlMocks.findOneAndUpdate.mockClear()
    await check(reqWithHeaders({ 'cf-connecting-ip': '198.51.100.9' }), 'api', {
      limit: 5,
      windowMs: 60_000,
    })
    expect(rlMocks.findOneAndUpdate.mock.calls[0][0]._id).toContain('198.51.100.9')
  })

  it('uses extraKey principal when proxy IP is unavailable', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false')
    delete process.env.VERCEL
    const check = await importCheckRateLimit()
    await check(new Request('http://localhost/test'), 'login', {
      limit: 5,
      windowMs: 60_000,
    }, 'User@Example.COM')
    expect(rlMocks.findOneAndUpdate.mock.calls[0][0]._id).toBe('login:id:user@example.com')
  })

  it('uses shared principal when there is no IP and no extraKey', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false')
    delete process.env.VERCEL
    const check = await importCheckRateLimit()
    await check(new Request('http://localhost/test'), 'anon', { limit: 3, windowMs: 60_000 })
    expect(rlMocks.findOneAndUpdate.mock.calls[0][0]._id).toBe('anon:shared')
  })

  it('appends extraKey to the bucket when both IP and extraKey are present', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    const check = await importCheckRateLimit()
    await check(reqWithHeaders({ 'x-forwarded-for': '1.2.3.4' }), 'login', {
      limit: 5,
      windowMs: 60_000,
    }, 'alice@test.com')
    expect(rlMocks.findOneAndUpdate.mock.calls[0][0]._id).toBe(
      'login:1.2.3.4:alice@test.com',
    )
  })

  it('denies when count exceeds limit', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    rlMocks.leanResult = {
      count: 6,
      windowStart: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    const check = await importCheckRateLimit()
    const v = await check(reqWithHeaders({ 'x-forwarded-for': '9.9.9.9' }), 'api', {
      limit: 5,
      windowMs: 60_000,
    })
    expect(v.allowed).toBe(false)
    expect(v.remaining).toBe(0)
  })

  it('fails open on Mongo errors for non-auth scopes', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    rlMocks.connectDB.mockRejectedValueOnce(new Error('mongo down'))
    const check = await importCheckRateLimit()
    const v = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'public-form', {
      limit: 3,
      windowMs: 60_000,
    })
    expect(v.allowed).toBe(true)
    expect(v.remaining).toBe(2)
  })

  it('fails closed on Mongo errors for login scope', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    rlMocks.connectDB.mockRejectedValueOnce(new Error('mongo down'))
    const check = await importCheckRateLimit()
    const v = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'login', {
      limit: 3,
      windowMs: 60_000,
    })
    expect(v.allowed).toBe(false)
    expect(v.remaining).toBe(0)
  })

  it('fails closed for pwd-reset scopes and explicit failClosed', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    rlMocks.connectDB.mockRejectedValue(new Error('mongo down'))
    const check = await importCheckRateLimit()
    const reset = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'pwd-reset-email', {
      limit: 3,
      windowMs: 60_000,
    })
    expect(reset.allowed).toBe(false)

    rlMocks.connectDB.mockRejectedValue(new Error('mongo down'))
    const custom = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'custom', {
      limit: 3,
      windowMs: 60_000,
      failClosed: true,
    })
    expect(custom.allowed).toBe(false)
  })

  it('fails closed on Mongo errors for import and email-send scopes', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    rlMocks.connectDB.mockRejectedValue(new Error('mongo down'))
    const check = await importCheckRateLimit()
    const importV = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'import', {
      limit: 10,
      windowMs: 60_000,
    })
    expect(importV.allowed).toBe(false)

    rlMocks.connectDB.mockRejectedValue(new Error('mongo down'))
    const emailV = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'send-file-email', {
      limit: 20,
      windowMs: 60_000,
    })
    expect(emailV.allowed).toBe(false)
  })

  it('uses Upstash Redis when env vars are set', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    upstashMocks.limit.mockResolvedValueOnce({
      success: true,
      remaining: 9,
      reset: Date.now() + 30_000,
    })
    const check = await importCheckRateLimit()
    const v = await check(reqWithHeaders({ 'x-forwarded-for': '5.5.5.5' }), 'search', {
      limit: 10,
      windowMs: 60_000,
    })
    expect(v.allowed).toBe(true)
    expect(v.remaining).toBe(9)
    expect(rlMocks.connectDB).not.toHaveBeenCalled()
    expect(upstashMocks.limit).toHaveBeenCalledWith('5.5.5.5')
  })

  it('fails closed on Redis errors for import scope', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    upstashMocks.limit.mockRejectedValueOnce(new Error('redis down'))
    const check = await importCheckRateLimit()
    const v = await check(reqWithHeaders({ 'x-forwarded-for': '1.1.1.1' }), 'import', {
      limit: 10,
      windowMs: 60_000,
    })
    expect(v.allowed).toBe(false)
    expect(rlMocks.connectDB).not.toHaveBeenCalled()
  })

  it('fails open when upsert returns no document', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    rlMocks.leanResult = null
    rlMocks.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve(null),
    })
    const check = await importCheckRateLimit()
    const v = await check(reqWithHeaders({ 'x-forwarded-for': '8.8.8.8' }), 'api', {
      limit: 2,
      windowMs: 30_000,
    })
    expect(v.allowed).toBe(true)
    expect(v.remaining).toBe(1)
  })
})

describe('isFailClosedScope / isEmailSendScope', () => {
  async function importHelpers() {
    vi.resetModules()
    return import('./rate-limit')
  }

  it('classifies auth, import, and email-send scopes as fail-closed', async () => {
    const { isFailClosedScope, isEmailSendScope, ORG_SCOPED_READ_EXEMPT_SCOPES } =
      await importHelpers()
    expect(isFailClosedScope('login')).toBe(true)
    expect(isFailClosedScope('pwd-reset-confirm')).toBe(true)
    expect(isFailClosedScope('import')).toBe(true)
    expect(isFailClosedScope('send-file-email')).toBe(true)
    expect(isEmailSendScope('send-statement-emails')).toBe(true)
    expect(isFailClosedScope('search')).toBe(false)
    expect(isFailClosedScope('custom', { failClosed: true, limit: 1, windowMs: 60_000 })).toBe(true)
    expect(ORG_SCOPED_READ_EXEMPT_SCOPES).toContain('families-list')
    expect(ORG_SCOPED_READ_EXEMPT_SCOPES).toContain('dashboard-stats')
  })
})
