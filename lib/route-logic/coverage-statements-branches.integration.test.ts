/**
 * Branch/function coverage for statements, send-file-email, and tax-receipt email workers.
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

function bindSession(c: ApiTestContext, role: 'owner' | 'admin' | 'member' = 'owner', orgId?: string) {
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

async function withCompoundCursorSpy(fn: () => Promise<void>) {
  const pag = await import('@/lib/pagination')
  const spy = vi.spyOn(pag, 'collectCompoundCursorPages').mockImplementation(
    async (loadPage, baseFilter, _sf, _dir, getCursor, _bs) => {
      const page = await loadPage(baseFilter, 3)
      if (page[0]) getCursor(page[0] as never)
      return page
    },
  )
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
}

async function seedEmailConfig(orgId = ctx.orgId) {
  const { EmailConfig } = await import('@/lib/models')
  const enc = await import('@/lib/encryption')
  await EmailConfig.updateOne(
    { organizationId: orgId },
    {
      $set: {
        email: 'sender@example.com',
        password: enc.encrypt('app-password'),
        fromName: 'Test Org',
        isActive: true,
      },
    },
    { upsert: true },
  )
}

describe.sequential('statements branch coverage', () => {
  const year = () => new Date().getFullYear()

  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
  })

  describe('generate-pdf POST branches', () => {
    it('validates body, returns PDF on success, and exercises name/org fallbacks', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/statements/generate-pdf')

      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/statements/generate-pdf', 'POST', {
                statement: { _id: ctx.fixtures.statementId },
              }),
            )
          ).status,
        ).toBe(429)
      })

      const badJson = await POST(
        new NextRequest(`${API_ORIGIN}/api/statements/generate-pdf`, {
          method: 'POST',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'x-organization-id': ctx.orgId,
            'content-type': 'application/json',
          },
          body: 'not-json',
        }),
      )
      expect(badJson.status).toBe(400)

      expect(
        (await POST(orgJsonReq('/api/statements/generate-pdf', 'POST', ['array']))).status,
      ).toBe(400)
      expect(
        (await POST(orgJsonReq('/api/statements/generate-pdf', 'POST', { statement: { _id: 'bad' } }))).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/statements/generate-pdf', 'POST', {
              statement: { _id: new Types.ObjectId().toString() },
            }),
          )
        ).status,
      ).toBe(404)

      const ok = await POST(
        orgJsonReq('/api/statements/generate-pdf', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect(ok.status).toBe(200)
      expect(ok.headers.get('content-type')).toBe('application/pdf')
      const pdfBytes = new Uint8Array(await ok.arrayBuffer())
      expect(pdfBytes.length).toBeGreaterThan(0)

      const { Organization } = await import('@/lib/models')
      const orgSpy = vi.spyOn(Organization, 'findById').mockReturnValueOnce({
        select: () => ({
          lean: async () => null,
        }),
      } as never)
      const noOrg = await POST(
        orgJsonReq('/api/statements/generate-pdf', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect(noOrg.status).toBe(200)
      orgSpy.mockRestore()

      const { Family } = await import('@/lib/models')
      await Family.updateOne({ _id: ctx.fixtures.familyId }, { $unset: { name: 1 } })
      const named = await POST(
        orgJsonReq('/api/statements/generate-pdf', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
          familyName: 'Client Family Name',
        }),
      )
      expect(named.status).toBe(200)
      await Family.updateOne({ _id: ctx.fixtures.familyId }, { $set: { name: 'API Route Marker Family' } })
    })
  })

  describe('members/[memberId]/statements branches', () => {
    it('skips invalid lifecycle amounts and handles refresh fallbacks', async () => {
      bindSession(ctx, 'admin')
      const { LifecycleEventPayment, Statement } = await import('@/lib/models')
      const y = year()

      await LifecycleEventPayment.collection.insertMany([
        {
          organizationId: new Types.ObjectId(ctx.orgId),
          memberId: new Types.ObjectId(ctx.fixtures.memberId),
          familyId: new Types.ObjectId(ctx.fixtures.familyId),
          eventType: 'bar_mitzvah',
          eventDate: new Date(`${y}-06-10`),
          amount: -25,
        },
        {
          organizationId: new Types.ObjectId(ctx.orgId),
          memberId: new Types.ObjectId(ctx.fixtures.memberId),
          familyId: new Types.ObjectId(ctx.fixtures.familyId),
          eventType: 'wedding',
          eventDate: new Date(`${y}-06-11`),
          amount: Number.NaN,
        },
      ])

      const range = { fromDate: `${y}-06-01`, toDate: `${y}-06-30` }
      const { POST } = await import('@/lib/route-logic/members/[memberId]/statements')

      const first = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', range),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(first.status).toBeGreaterThanOrEqual(200)

      const updateSpy = vi.spyOn(Statement, 'findOneAndUpdate').mockResolvedValueOnce(null as never)
      const refreshed = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', range),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(refreshed.status).toBeGreaterThanOrEqual(200)
      updateSpy.mockRestore()

      const dupErr = Object.assign(new Error('duplicate'), { code: 11000 })
      const createSpy = vi.spyOn(Statement, 'create').mockRejectedValueOnce(dupErr)
      const raceUpdateSpy = vi.spyOn(Statement, 'findOneAndUpdate').mockResolvedValueOnce(null as never)
      const raced = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', range),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(raced.status).toBeGreaterThanOrEqual(200)
      createSpy.mockRestore()
      raceUpdateSpy.mockRestore()

      const createSpy2 = vi.spyOn(Statement, 'create').mockRejectedValueOnce(dupErr)
      const findSpy = vi.spyOn(Statement, 'findOne').mockResolvedValueOnce(null as never)
      const noRace = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', {
          fromDate: `${y}-07-01`,
          toDate: `${y}-07-31`,
        }),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(noRace.status).toBe(500)
      createSpy2.mockRestore()
      findSpy.mockRestore()

      await LifecycleEventPayment.collection.deleteMany({
        organizationId: new Types.ObjectId(ctx.orgId),
        memberId: new Types.ObjectId(ctx.fixtures.memberId),
        eventDate: { $gte: new Date(`${y}-06-01`), $lte: new Date(`${y}-06-30`) },
      })
    })

    it('GET rate limits and exercises compound cursor callback', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/members/[memberId]/statements')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'GET'), {
              params: { memberId: ctx.fixtures.memberId },
            })
          ).status,
        ).toBe(429)
      })
      await withCompoundCursorSpy(async () => {
        expect(
          (
            await GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'GET'), {
              params: { memberId: ctx.fixtures.memberId },
            })
          ).status,
        ).toBe(200)
      })
    })
  })

  describe('statements send-emails worker callbacks', () => {
    it('records per-family failures, loop recovery, and continuation success', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const sendSpy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValueOnce({ ok: false, email: 'fail@example.com', error: 'smtp rejected' })
        .mockResolvedValueOnce({ ok: true, email: null })
        .mockImplementationOnce(() => {
          throw new Error('smtp socket died')
        })

      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
      vi.stubGlobal('fetch', fetchSpy)

      try {
        const ids = await Promise.all(
          [0, 1, 2, 3, 4, 5].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Stmt Branch ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
              email: `stmt-branch-${i}-${Date.now()}@example.com`,
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
          errors: [],
        })
        bindSession(ctx)
        const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
        const loopFail = await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(loopFail.status).toBe(500)

        sendSpy.mockReset()
        sendSpy.mockResolvedValue({ ok: true, email: null })
        const contJob = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'statements',
          status: 'queued',
          fromDate: new Date(`${year()}-01-01`),
          toDate: new Date(`${year()}-12-31`),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
        })
        const cont = await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: contJob._id.toString() }),
        )
        expect(cont.status).toBe(200)
        await new Promise((r) => setTimeout(r, 80))
        expect(fetchSpy).toHaveBeenCalled()

        await EmailJob.deleteMany({ _id: { $in: [job._id, contJob._id] } })
        await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
      } finally {
        sendSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    it('returns early for completed jobs and missing email config', async () => {
      const { EmailJob, EmailConfig } = await import('@/lib/models')
      const doneJob = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'completed',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 0,
        pending: [],
        completedAt: new Date(),
      })
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const done = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: doneJob._id.toString() }),
      )
      expect((await done.json()).done).toBe(true)

      await EmailConfig.deleteMany({ organizationId: ctx.orgId })
      const cfgJob = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      const noCfg = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: cfgJob._id.toString() }),
      )
      expect((await noCfg.json()).status).toBe('failed')

      await seedEmailConfig()
      await EmailJob.deleteMany({ _id: { $in: [doneJob._id, cfgJob._id] } })
    })

    it('caps error list and awaits continuation fetch callbacks', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const sendSpy = vi.spyOn(sendMod, 'sendOneFamilyStatement').mockResolvedValue({
        ok: false,
        email: 'x@example.com',
        error: 'fail',
      })
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
      vi.stubGlobal('fetch', fetchSpy)

      try {
        const ids = await Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Stmt Cap ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
            }),
          ),
        )
        const paddedErrors = Array.from({ length: 199 }, (_, i) => ({
          familyId: new Types.ObjectId().toString(),
          email: `e${i}@example.com`,
          error: 'old',
        }))
        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'statements',
          status: 'queued',
          fromDate: new Date(`${year()}-01-01`),
          toDate: new Date(`${year()}-12-31`),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
          errors: paddedErrors,
        })
        bindSession(ctx)
        const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
        const res = await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        await new Promise((r) => setTimeout(r, 150))
        expect(fetchSpy).toHaveBeenCalled()
        await EmailJob.deleteOne({ _id: job._id })
        await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
      } finally {
        sendSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    it('accepts cron auth with organizationId query param', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const sendSpy = vi.spyOn(sendMod, 'sendOneFamilyStatement').mockResolvedValue({ ok: true, email: null })
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq(
          '/api/statements/send-emails/worker',
          'POST',
          { jobId: job._id.toString() },
          { cron: true, query: `?organizationId=${ctx.orgId}` },
        ),
      )
      expect(res.status).toBe(200)
      sendSpy.mockRestore()
      await EmailJob.deleteOne({ _id: job._id })
    })
  })

  describe('send-emails status branches', () => {
    it('auto-fails stale jobs with default lastError and validates jobId', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/statements/send-emails/status')
      expect(
        (await GET(orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, { query: '?jobId=bad' })))
          .status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
              query: `?jobId=${new Types.ObjectId()}`,
            }),
          )
        ).status,
      ).toBe(404)

      const { EmailJob } = await import('@/lib/models')
      const { EMAIL_JOB_STALE_AFTER_MS } = await import('@/lib/email-jobs')
      const staleAt = new Date(Date.now() - EMAIL_JOB_STALE_AFTER_MS - 120_000)
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'running',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 3,
        pending: [new Types.ObjectId()],
        processed: 1,
      })
      await EmailJob.updateOne({ _id: job._id }, { $set: { updatedAt: staleAt } }, { timestamps: false })

      const res = await GET(
        orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, { query: `?jobId=${job._id}` }),
      )
      const body = await res.json()
      const payload = body.data ?? body
      expect(payload.status).toBe('failed')
      expect(payload.done).toBe(true)
      const stored = await EmailJob.findById(job._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(String(stored?.lastError ?? '')).toMatch(/auto-failed/i)
      await EmailJob.deleteOne({ _id: job._id })
    })
  })

  describe('tax-receipts email worker branches', () => {
    it('rejects wrong job kind and records send failures with loop recovery', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const stmtJob = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      expect(
        (await POST(orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: stmtJob._id.toString() }))).status,
      ).toBe(400)
      await EmailJob.deleteOne({ _id: stmtJob._id })

      const { Family } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const sendSpy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValueOnce({ ok: false, email: 'bad@example.com', error: 'receipt fail' })
        .mockImplementationOnce(() => {
          throw new Error('pdf render exploded')
        })

      const ids = await Promise.all(
        [0, 1, 2].map((i) =>
          Family.create({
            organizationId: ctx.orgId,
            name: `Tax Branch ${i} ${Date.now()}`,
            weddingDate: new Date('2010-01-01'),
          }),
        ),
      )
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'queued',
        year: year(),
        totalFamilies: ids.length,
        pending: ids.map((f) => f._id),
        errors: [],
      })
      const loopFail = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(loopFail.status).toBe(500)

      sendSpy.mockRestore()
      await EmailJob.deleteOne({ _id: job._id })
      await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
    })

    it('runs continuation fetch success and loop error with only failures recorded', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const sendSpy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValueOnce({ ok: false, email: 'a@b.com', error: 'nope' })
        .mockImplementationOnce(() => {
          throw new Error('batch abort')
        })
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' })
      vi.stubGlobal('fetch', fetchSpy)

      try {
        const ids = await Promise.all(
          [0, 1, 2, 3].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Tax Fetch ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
            }),
          ),
        )
        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'tax-receipts',
          status: 'queued',
          year: year(),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
          errors: [],
        })
        bindSession(ctx)
        const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
        const fail = await POST(
          orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(fail.status).toBe(500)

        sendSpy.mockReset()
        sendSpy.mockResolvedValue({ ok: true, email: null })
        const contJob = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'tax-receipts',
          status: 'queued',
          year: year(),
          totalFamilies: ids.length,
          pending: ids.map((f) => f._id),
        })
        const ok = await POST(
          orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: contJob._id.toString() }),
        )
        expect(ok.status).toBe(200)
        await new Promise((r) => setTimeout(r, 150))
        expect(fetchSpy).toHaveBeenCalled()

        await EmailJob.deleteMany({ _id: { $in: [job._id, contJob._id] } })
        await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
      } finally {
        sendSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    it('returns completed status and fails when decrypt breaks', async () => {
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC',
            fromName: 'Test',
            isActive: true,
          },
        },
        { upsert: true },
      )
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'failed',
        year: year(),
        totalFamilies: 0,
        pending: [],
        completedAt: new Date(),
      })
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect((await res.json()).done).toBe(true)

      const queued = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'queued',
        year: year(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      const fail = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: queued._id.toString() }),
      )
      expect((await fail.json()).status).toBe('failed')

      await seedEmailConfig()
      await EmailJob.deleteMany({ _id: { $in: [job._id, queued._id] } })
    })
  })

  describe('send-file-email mime and attachment branches', () => {
    it('accepts charset mime suffix and default attachment filename', async () => {
      bindSession(ctx, 'admin')
      await seedEmailConfig()
      const { POST } = await import('@/lib/route-logic/send-file-email')

      const charsetForm = new FormData()
      charsetForm.set('to', ctx.email)
      charsetForm.set('file', new Blob(['%PDF'], { type: 'application/pdf; charset=utf-8' }), 'typed.pdf')
      expect((await POST(sendFileReq(charsetForm))).status).toBe(200)

      const sanitizedForm = new FormData()
      sanitizedForm.set('to', ctx.email)
      sanitizedForm.set(
        'file',
        new File(['%PDF'], 'bad\r\nname.pdf', { type: 'application/pdf' }),
      )
      expect((await POST(sendFileReq(sanitizedForm))).status).toBe(200)

      const unsafe = new FormData()
      unsafe.set('to', ctx.email)
      unsafe.set('file', new Blob(['MZ'], { type: 'application/octet-stream' }), 'virus.exe')
      expect((await POST(sendFileReq(unsafe))).status).toBe(415)
    })
  })
})
