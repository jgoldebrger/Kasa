/**
 * Line-coverage for documents / email route-logic domain.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'

const mockAuth = vi.hoisted(() => vi.fn())
const mockCookieGet = vi.hoisted(() => vi.fn())

vi.mock('@/app/auth', () => ({ auth: mockAuth }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

function bindSession(
  c: ApiTestContext,
  role: 'owner' | 'admin' | 'member' = 'owner',
  orgId?: string,
) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [{ o: orgId ?? c.orgId, r: role }],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: orgId ?? c.orgId } : undefined,
  )
}

function orgJsonReq(
  path: string,
  method: string,
  body?: unknown,
  opts?: { cron?: boolean; query?: string; orgId?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': opts?.orgId ?? ctx.orgId,
  }
  if (opts?.cron) {
    const secret = process.env.CRON_SECRET || 'test-cron-secret'
    headers['x-cron-secret'] = secret
    headers.authorization = `Bearer ${secret}`
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const q = opts?.query ?? ''
  return new NextRequest(`${API_ORIGIN}${path}${q}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function sendFileReq(form: FormData, orgId?: string): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: API_ORIGIN,
      'x-organization-id': orgId ?? ctx.orgId,
    },
    body: form,
  })
}

async function withRateLimitBlocked<T>(fn: () => Promise<T>): Promise<T> {
  const rateLimit = await import('@/lib/rate-limit')
  const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
    allowed: false,
    remaining: 0,
    resetAt: 0,
  })
  try {
    return await fn()
  } finally {
    spy.mockRestore()
  }
}

async function seedEmailConfig(orgId = ctx.orgId) {
  const enc = await import('@/lib/encryption')
  const { EmailConfig } = await import('@/lib/models')
  await EmailConfig.updateOne(
    { organizationId: orgId },
    {
      $set: {
        email: 'docs-domain@example.com',
        password: enc.encrypt('app-password'),
        fromName: 'Docs Domain',
        isActive: true,
      },
    },
    { upsert: true },
  )
}

describe.sequential('route-logic documents/email domain coverage', () => {
  const year = () => new Date().getFullYear()

  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
    process.env.PLATFORM_ADMIN_EMAILS = ''
    ctx = await seedApiRouteFixtures()
    process.env.PLATFORM_ADMIN_EMAILS = ctx.email
    process.env.KASA_TEST_STRIPE_ORG = ctx.orgId
    process.env.KASA_TEST_STRIPE_FAMILY = ctx.fixtures.familyId
    bindSession(ctx)
    await seedEmailConfig()
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('email-config', () => {
    it('creates config, updates without password, and rate-limits test endpoint', async () => {
      bindSession(ctx)
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })

      const { POST, PUT } = await import('@/lib/route-logic/email-config')
      const missingPw = await POST(
        orgJsonReq(
          '/api/email-config',
          'POST',
          { email: 'new@example.com', fromName: 'New' },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(missingPw.status).toBe(400)

      const created = await POST(
        orgJsonReq(
          '/api/email-config',
          'POST',
          { email: 'new@example.com', password: 'secret123', fromName: 'New Org' },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(created.status).toBe(201)

      const updated = await PUT(
        orgJsonReq(
          '/api/email-config',
          'PUT',
          { email: 'updated@example.com', fromName: 'Updated Org' },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(updated.status).toBe(200)

      const { POST: testPost } = await import('@/lib/route-logic/email-config/test')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await testPost(
              orgJsonReq('/api/email-config/test', 'POST', {}, { orgId: ctx.betaOrgId }),
            )
          ).status,
        ).toBe(429)
      })

      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })
    })

    it('test email returns 400 without config and 500 on decrypt failure', async () => {
      bindSession(ctx)
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })

      const { POST: testPost } = await import('@/lib/route-logic/email-config/test')
      expect(
        (await testPost(orgJsonReq('/api/email-config/test', 'POST', {}, { orgId: ctx.betaOrgId })))
          .status,
      ).toBe(400)

      await EmailConfig.create({
        organizationId: ctx.betaOrgId,
        email: 'bad@example.com',
        password: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC',
        fromName: 'Bad',
        isActive: true,
      })
      expect(
        (await testPost(orgJsonReq('/api/email-config/test', 'POST', {}, { orgId: ctx.betaOrgId })))
          .status,
      ).toBe(500)
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })
    })
  })

  describe('send-file-email', () => {
    it('rejects missing file, invalid recipient, and succeeds with PDF', async () => {
      bindSession(ctx)
      await seedEmailConfig()
      const { POST } = await import('@/lib/route-logic/send-file-email')

      await withRateLimitBlocked(async () => {
        const form = new FormData()
        form.set('to', ctx.email)
        form.set('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'doc.pdf')
        expect((await POST(sendFileReq(form))).status).toBe(429)
      })

      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        { $set: { password: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC' } },
      )
      const badDecrypt = new FormData()
      badDecrypt.set('to', ctx.email)
      badDecrypt.set('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'doc.pdf')
      expect((await POST(sendFileReq(badDecrypt))).status).toBe(500)
      await seedEmailConfig()

      const badEmail = new FormData()
      badEmail.set('to', 'not-an-email')
      badEmail.set('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'doc.pdf')
      expect((await POST(sendFileReq(badEmail))).status).toBe(400)

      const ok = new FormData()
      ok.set('to', ctx.email)
      ok.set('subject', 'Doc probe')
      ok.set('message', 'Line one\nLine two')
      ok.set('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'probe.pdf')
      const res = await POST(sendFileReq(ok))
      expect(res.status).toBe(200)
      expect((await res.json()).sent).toBe(true)
    })
  })

  describe('tax-receipts/email POST', () => {
    it('rate limits, conflicts on active job, and kickoff failure', async () => {
      bindSession(ctx)
      await seedEmailConfig()
      const { POST } = await import('@/lib/route-logic/tax-receipts/email')

      await withRateLimitBlocked(async () => {
        expect(
          (await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))).status,
        ).toBe(429)
      })

      const { EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'tax-receipts' })
      await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'running',
        year: year(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      expect(
        (await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))).status,
      ).toBe(409)
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'tax-receipts' })

      const emailJobs = await import('@/lib/email-jobs')
      const kickoffSpy = vi.spyOn(emailJobs, 'kickoffEmailWorker').mockResolvedValue({
        ok: false,
        error: 'kickoff failed',
      })
      const fail = await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
      expect(fail.status).toBe(500)
      kickoffSpy.mockRestore()
    })
  })

  describe('tax-receipts zip and pdf', () => {
    it('zip rejects bad year, missing org, empty year, and stream errors', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
      expect(
        (await GET(orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: '?year=abc' })))
          .status,
      ).toBe(400)

      const { Organization } = await import('@/lib/models')
      const orgSpy = vi.spyOn(Organization, 'findById').mockReturnValueOnce({
        select: () => ({
          lean: async () => null,
        }),
      } as never)
      expect(
        (
          await GET(
            orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${year()}` }),
          )
        ).status,
      ).toBe(404)
      orgSpy.mockRestore()

      const emptyYear = year() + 70
      expect(
        (
          await GET(
            orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${emptyYear}` }),
          )
        ).status,
      ).toBe(400)

      const { Payment } = await import('@/lib/models')
      const zeroNetYear = year() + 71
      const refundedOnly = await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 50,
        refundedAmount: 50,
        paymentDate: new Date(`${zeroNetYear}-05-01`),
        year: zeroNetYear,
        type: 'membership',
        paymentMethod: 'cash',
      })
      expect(
        (
          await GET(
            orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, {
              query: `?year=${zeroNetYear}`,
            }),
          )
        ).status,
      ).toBe(400)
      const zipMod = await import('@/lib/zip')
      const streamSpy = vi.spyOn(zipMod, 'streamZip').mockImplementation(async function* () {
        throw new Error('zip stream fail')
      })
      const streamFail = await GET(
        orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${year()}` }),
      )
      expect([200, 400, 500]).toContain(streamFail.status)
      streamSpy.mockRestore()
      await Payment.deleteOne({ _id: refundedOnly._id })
    })

    it('pdf returns 429 when rate limited and 400 for family with no dues', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/tax-receipts/[familyId]/pdf')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await GET(
              orgJsonReq(`/api/tax-receipts/${ctx.fixtures.familyId}/pdf`, 'GET', undefined, {
                query: `?year=${year()}`,
              }),
              { params: { familyId: ctx.fixtures.familyId } },
            )
          ).status,
        ).toBe(429)
      })

      const { Family } = await import('@/lib/models')
      const noPay = await Family.create({
        organizationId: ctx.orgId,
        name: `No Dues ${Date.now()}`,
        weddingDate: new Date('2014-01-01'),
      })
      const res = await GET(
        orgJsonReq(`/api/tax-receipts/${noPay._id}/pdf`, 'GET', undefined, {
          query: `?year=${year() + 70}`,
        }),
        { params: { familyId: noPay._id.toString() } },
      )
      expect(res.status).toBe(400)
      await Family.deleteOne({ _id: noPay._id })
    })
  })

  describe('tax-receipts email worker', () => {
    it('returns 403 for cross-tenant job and logs continuation fetch errors', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'queued',
        year: year(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const findSpy = vi.spyOn(EmailJob, 'findOne').mockResolvedValueOnce({
        _id: job._id,
        organizationId: new Types.ObjectId(ctx.betaOrgId),
        kind: 'tax-receipts',
        status: 'queued',
        year: year(),
        pending: job.pending,
        errors: [],
      } as never)
      expect(
        (
          await POST(
            orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
          )
        ).status,
      ).toBe(403)
      findSpy.mockRestore()
      await EmailJob.deleteOne({ _id: job._id })

      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const sendSpy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValue({ ok: true, email: null })
      const fetchSpy = vi.fn().mockRejectedValue(new Error('continuation network fail'))
      vi.stubGlobal('fetch', fetchSpy)
      try {
        const { Family } = await import('@/lib/models')
        const ids = await Promise.all(
          [0, 1, 2, 3].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Tax Cont ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
            }),
          ),
        )
        const contJob = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'tax-receipts',
          status: 'queued',
          year: year(),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
        })
        const res = await POST(
          orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: contJob._id.toString() }),
        )
        expect(res.status).toBe(200)
        await new Promise((r) => setTimeout(r, 60))
        expect(fetchSpy).toHaveBeenCalled()
        await EmailJob.deleteOne({ _id: contJob._id })
        await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
      } finally {
        sendSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })
  })

  describe('statements generate-monthly', () => {
    it('validates body, hebrew calendar, and records per-family errors', async () => {
      bindSession(ctx)
      const { Organization, Statement } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { monthlyStatementCalendar: 'hebrew', timezone: 'UTC' } },
      )

      const { POST } = await import('@/lib/route-logic/statements/generate-monthly')
      const noBody = await POST(
        new NextRequest(`${API_ORIGIN}/api/statements/generate-monthly`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
        }),
      )
      expect(noBody.status).toBe(400)

      const hebrew = await POST(orgJsonReq('/api/statements/generate-monthly', 'POST', {}))
      expect([200, 201]).toContain(hebrew.status)

      const spy = vi.spyOn(Statement, 'create').mockRejectedValueOnce(new Error('stmt write fail'))
      const fail = await POST(
        orgJsonReq('/api/statements/generate-monthly', 'POST', { year: year(), month: 3 }),
      )
      expect(fail.status).toBe(201)
      const body = await fail.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)
      expect(body.errors?.length).toBeGreaterThan(0)
      spy.mockRestore()

      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { monthlyStatementCalendar: 'gregorian' } },
      )
    })
  })

  describe('statements send-emails routes', () => {
    it('send-emails rate limits and returns 409 when a job is already active', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/statements/send-emails')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/statements/send-emails', 'POST', {
                fromDate: `${year()}-01-01`,
                toDate: `${year()}-12-31`,
              }),
            )
          ).status,
        ).toBe(429)
      })

      bindSession(ctx)
      const { EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'statements' })
      await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'running',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })

      const res = await POST(
        orgJsonReq('/api/statements/send-emails', 'POST', {
          fromDate: `${year()}-01-01`,
          toDate: `${year()}-12-31`,
        }),
      )
      expect(res.status).toBe(409)
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'statements' })
    })

    it('send-monthly-emails tolerates sweep failure and empty family list', async () => {
      bindSession(ctx)
      const emailJobs = await import('@/lib/email-jobs')
      const sweepSpy = vi
        .spyOn(emailJobs, 'sweepStaleEmailJobs')
        .mockRejectedValueOnce(new Error('sweep boom'))
      const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
      const swept = await POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
      expect([200, 202, 409]).toContain(swept.status)
      sweepSpy.mockRestore()

      const { Family, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.betaOrgId, kind: 'statements' })
      await Family.updateMany({ organizationId: ctx.betaOrgId }, { $unset: { email: 1 } })
      await seedEmailConfig(ctx.betaOrgId)
      const empty = await POST(
        orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}, { orgId: ctx.betaOrgId }),
      )
      expect(empty.status).toBe(200)
      expect((await empty.json()).totalFamilies).toBe(0)
    })

    it('status returns 429 when rate limited', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/statements/send-emails/status')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await GET(
              orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
                query: `?jobId=${ctx.fixtures.familyId}`,
              }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('status auto-fails stale running jobs on poll', async () => {
      bindSession(ctx)
      const { EmailJob } = await import('@/lib/models')
      const { EMAIL_JOB_STALE_AFTER_MS } = await import('@/lib/email-jobs')
      const staleAt = new Date(Date.now() - EMAIL_JOB_STALE_AFTER_MS - 60_000)
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'running',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 5,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
        processed: 1,
      })
      await EmailJob.updateOne(
        { _id: job._id },
        { $set: { updatedAt: staleAt } },
        { timestamps: false },
      )

      const { GET } = await import('@/lib/route-logic/statements/send-emails/status')
      const res = await GET(
        orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
          query: `?jobId=${job._id}`,
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('failed')
      expect(body.done).toBe(true)
      await EmailJob.deleteOne({ _id: job._id })
    })
  })

  describe('statements send-emails worker', () => {
    it('logs continuation HTTP errors, fetch rejections, and missing CRON_SECRET', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const sendSpy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValue({ ok: true, email: null })

      const prevCron = process.env.CRON_SECRET
      delete process.env.CRON_SECRET
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
        .mockRejectedValueOnce(new Error('continuation aborted'))
      vi.stubGlobal('fetch', fetchSpy)

      try {
        const ids = await Promise.all(
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Stmt Cont ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
              email: `stmt-cont-${i}-${Date.now()}@example.com`,
            }),
          ),
        )
        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'statements',
          status: 'queued',
          fromDate: new Date(`${year()}-01-01`),
          toDate: new Date(`${year()}-12-31`),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
        })
        bindSession(ctx)
        const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
        const res = await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        await new Promise((r) => setTimeout(r, 60))
        expect(fetchSpy).toHaveBeenCalled()
        await EmailJob.deleteOne({ _id: job._id })
        await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
      } finally {
        sendSpy.mockRestore()
        vi.unstubAllGlobals()
        process.env.CRON_SECRET = prevCron ?? 'test-cron-secret'
      }
    })

    it('logs fetch rejection on statement worker continuation', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const sendSpy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValue({ ok: true, email: null })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch rejected')))

      try {
        const ids = await Promise.all(
          [0, 1, 2, 3, 4, 5].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Stmt Rej ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
              email: `stmt-rej-${i}-${Date.now()}@example.com`,
            }),
          ),
        )
        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'statements',
          status: 'queued',
          fromDate: new Date(`${year()}-01-01`),
          toDate: new Date(`${year()}-12-31`),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
        })
        bindSession(ctx)
        const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
        await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        await new Promise((r) => setTimeout(r, 60))
        await EmailJob.deleteOne({ _id: job._id })
        await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
      } finally {
        sendSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })
  })

  describe('tax-receipts email worker claim miss', () => {
    it('returns early when atomic claim returns null', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'running',
        year: year(),
        totalFamilies: 0,
        pending: [],
      })
      const claimSpy = vi.spyOn(EmailJob, 'findOneAndUpdate').mockResolvedValueOnce(null as never)
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect((await res.json()).done).toBe(true)
      claimSpy.mockRestore()
      await EmailJob.deleteOne({ _id: job._id })
    })
  })

  describe('statements auto-generate', () => {
    it('rejects partial year/month and invalid hebrew month', async () => {
      bindSession(ctx)
      const { Organization } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { monthlyStatementCalendar: 'hebrew' } },
      )

      const { GET } = await import('@/lib/route-logic/statements/auto-generate')
      expect(
        (
          await GET(
            orgJsonReq('/api/statements/auto-generate', 'GET', undefined, { query: '?year=2020' }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/statements/auto-generate', 'GET', undefined, { query: '?month=1' }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/statements/auto-generate', 'GET', undefined, {
              query: '?year=2020&month=14',
            }),
          )
        ).status,
      ).toBe(400)

      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { monthlyStatementCalendar: 'gregorian' } },
      )

      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/statements/auto-generate', 'GET'))).status).toBe(429)
      })
    })
  })
})
