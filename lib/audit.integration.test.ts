import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('audit (integration)', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { AuditLog } = await import('./models')
    await AuditLog.deleteMany({})
  })

  it('persists an AuditLog document', async () => {
    const { audit } = await import('./audit')
    const { AuditLog } = await import('./models')

    await audit({
      organizationId: '507f1f77bcf86cd799439011',
      userId: '507f1f77bcf86cd799439012',
      action: 'invite.create',
      resourceType: 'Invite',
      resourceId: '507f1f77bcf86cd799439013',
      metadata: { email: 'member@example.com', role: 'admin' },
    })

    const rows = await AuditLog.find({ action: 'invite.create' }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('invite.create')
    expect(rows[0].resourceType).toBe('Invite')
    expect(String(rows[0].organizationId)).toBe('507f1f77bcf86cd799439011')
    expect(String(rows[0].userId)).toBe('507f1f77bcf86cd799439012')
    expect(rows[0].metadata).toEqual({ email: 'member@example.com', role: 'admin' })
  })

  it('captures client IP from x-forwarded-for when TRUST_PROXY_HEADERS is true', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.VERCEL
    process.env.TRUST_PROXY_HEADERS = 'true'

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      const request = new Request('https://example.com/api/login', {
        headers: {
          'x-forwarded-for': '203.0.113.50, 10.0.0.1',
          'user-agent': 'IntegrationTest/1.0',
        },
      })

      await audit({
        action: 'auth.login.failed',
        resourceType: 'User',
        metadata: { attemptedEmail: 'nobody@example.com' },
        request,
      })

      const row = await AuditLog.findOne({ action: 'auth.login.failed' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row).toBeTruthy()
      expect(row!.ip).toBe('203.0.113.50')
      expect(row!.userAgent).toBe('IntegrationTest/1.0')
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('skips empty x-forwarded-for entries and uses the next header', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.VERCEL
    process.env.TRUST_PROXY_HEADERS = 'true'

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      const request = new Request('https://example.com/api/login', {
        headers: {
          'x-forwarded-for': ' , ',
          'x-real-ip': '198.51.100.20',
        },
      })

      await audit({
        action: 'auth.login.xff-empty',
        resourceType: 'User',
        request,
      })

      const row = await AuditLog.findOne({ action: 'auth.login.xff-empty' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row!.ip).toBe('198.51.100.20')
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('captures client IP from x-real-ip when trusted and x-forwarded-for is absent', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.VERCEL
    process.env.TRUST_PROXY_HEADERS = 'true'

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      const request = new Request('https://example.com/api/login', {
        headers: { 'x-real-ip': '198.51.100.10' },
      })

      await audit({
        action: 'auth.login.realip',
        resourceType: 'User',
        request,
      })

      const row = await AuditLog.findOne({ action: 'auth.login.realip' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row!.ip).toBe('198.51.100.10')
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('captures client IP from cf-connecting-ip when other proxy headers are absent', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.VERCEL
    process.env.TRUST_PROXY_HEADERS = 'true'

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      const request = new Request('https://example.com/api/login', {
        headers: { 'cf-connecting-ip': '203.0.113.77' },
      })

      await audit({
        action: 'auth.login.cf',
        resourceType: 'User',
        request,
      })

      const row = await AuditLog.findOne({ action: 'auth.login.cf' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row!.ip).toBe('203.0.113.77')
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('trusts proxy headers when VERCEL=1 without TRUST_PROXY_HEADERS', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.TRUST_PROXY_HEADERS
    process.env.VERCEL = '1'

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      const request = new Request('https://example.com/api/login', {
        headers: { 'x-forwarded-for': '203.0.113.88' },
      })

      await audit({
        action: 'auth.login.vercel',
        resourceType: 'User',
        request,
      })

      const row = await AuditLog.findOne({ action: 'auth.login.vercel' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row!.ip).toBe('203.0.113.88')
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('logs audit failures without throwing', async () => {
    const { audit } = await import('./audit')
    const models = await import('./models')
    const createSpy = vi.spyOn(models.AuditLog, 'create').mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      audit({
        action: 'invite.create.fail',
        resourceType: 'Invite',
      }),
    ).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith(
      '[audit] Failed to record event:',
      'invite.create.fail',
      expect.any(Error),
    )

    createSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('returns undefined IP when trusted but no proxy headers are present', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.VERCEL
    process.env.TRUST_PROXY_HEADERS = 'true'

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      await audit({
        action: 'auth.login.no-proxy-headers',
        resourceType: 'User',
        request: new Request('https://example.com/api/login'),
      })

      const row = await AuditLog.findOne({ action: 'auth.login.no-proxy-headers' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row).toBeTruthy()
      expect(row!.ip).toBeUndefined()
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('does not capture IP when proxy headers are not trusted', async () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS
    const prevVercel = process.env.VERCEL
    delete process.env.TRUST_PROXY_HEADERS
    delete process.env.VERCEL

    try {
      const { audit } = await import('./audit')
      const { AuditLog } = await import('./models')

      const request = new Request('https://example.com/api/login', {
        headers: { 'x-forwarded-for': '203.0.113.99' },
      })

      await audit({
        action: 'auth.login.attempt',
        resourceType: 'User',
        request,
      })

      const row = await AuditLog.findOne({ action: 'auth.login.attempt' }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(row).toBeTruthy()
      expect(row!.ip).toBeUndefined()
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY_HEADERS
      else process.env.TRUST_PROXY_HEADERS = prevTrust
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })
})
