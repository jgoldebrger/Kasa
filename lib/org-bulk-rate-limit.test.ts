import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkRateLimitMock = vi.fn()

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}))

describe('org-bulk-rate-limit', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...envBackup }
    delete process.env.ORG_RATE_LIMIT_IMPORT_PER_HOUR
    delete process.env.ORG_RATE_LIMIT_SEND_BULK_PER_HOUR
    delete process.env.ORG_RATE_LIMIT_EXPORT_PER_HOUR
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 3_600_000,
    })
  })

  afterEach(() => {
    process.env = envBackup
    vi.resetModules()
  })

  async function load() {
    return import('@/lib/org-bulk-rate-limit')
  }

  it('resolveOrgBulkRateLimit uses env defaults', async () => {
    process.env.ORG_RATE_LIMIT_IMPORT_PER_HOUR = '7'
    const mod = await load()

    expect(mod.resolveOrgBulkRateLimit('import')).toBe(7)
    expect(mod.resolveOrgBulkRateLimit('send-bulk')).toBe(10)
    expect(mod.resolveOrgBulkRateLimit('export')).toBe(5)
  })

  it('resolveOrgBulkRateLimit prefers org overrides', async () => {
    const mod = await load()

    expect(
      mod.resolveOrgBulkRateLimit('import', {
        importPerHour: 3,
        sendBulkPerHour: 4,
        exportPerHour: 2,
      }),
    ).toBe(3)
    expect(
      mod.resolveOrgBulkRateLimit('send-bulk', {
        importPerHour: 3,
        sendBulkPerHour: 4,
        exportPerHour: 2,
      }),
    ).toBe(4)
    expect(
      mod.resolveOrgBulkRateLimit('export', {
        importPerHour: 3,
        sendBulkPerHour: 4,
        exportPerHour: 2,
      }),
    ).toBe(2)
  })

  it('checkOrgBulkRateLimit keys by organization id and scopes', async () => {
    const mod = await load()
    const request = new Request('http://localhost/api/import')

    await mod.checkOrgBulkRateLimit(request, 'org-123', 'import', { importPerHour: 6 })

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      request,
      'import',
      expect.objectContaining({ limit: 6, windowMs: 3_600_000, failClosed: true }),
      'org-123',
    )
  })

  it('retryAfterSeconds returns at least one second', async () => {
    const mod = await load()
    const now = 1_700_000_000_000

    expect(mod.retryAfterSeconds(now + 500, now)).toBe(1)
    expect(mod.retryAfterSeconds(now + 5_500, now)).toBe(6)
  })

  it('orgBulkRateLimit429 includes Retry-After header', async () => {
    const mod = await load()
    const resetAt = Date.now() + 12_000
    const response = mod.orgBulkRateLimit429({
      allowed: false,
      remaining: 0,
      resetAt,
    })

    expect(response.status).toBe(429)
    expect(response.data.error).toMatch(/too many/i)
    expect(response.headers['Retry-After']).toBeTruthy()
    expect(Number(response.headers['Retry-After'])).toBeGreaterThanOrEqual(1)
  })
})
