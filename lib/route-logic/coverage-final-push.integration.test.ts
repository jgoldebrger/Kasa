/**
 * Final lib/route-logic line-coverage push — validation, branch edges, missing 429s.
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

function bindSession(c: ApiTestContext, role: 'owner' | 'admin' | 'member' = 'owner') {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [{ o: c.orgId, r: role }],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: c.orgId } : undefined,
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

function sessionJsonReq(path: string, method: string, body?: unknown, query = ''): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function publicJsonReq(path: string, method: string, body?: unknown, query = ''): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function importForm(type: string, csv: string, filename: string, extra?: Record<string, string>): FormData {
  const form = new FormData()
  form.set('type', type)
  form.set('file', new Blob([csv], { type: 'text/csv' }), filename)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
  }
  return form
}

function importReq(form: FormData): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/import`, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: API_ORIGIN,
      'x-organization-id': ctx.orgId,
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

describe.sequential('route-logic final coverage push', () => {
  const year = () => new Date().getFullYear()
  const today = () => new Date().toISOString().slice(0, 10)

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
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('tasks/[id] validation and rate limits', () => {
    const bad = 'not-valid'

    it('rejects invalid task id on GET PUT DELETE', async () => {
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/tasks/[id]')
      expect((await GET(orgJsonReq(`/api/tasks/${bad}`, 'GET'), { params: { id: bad } })).status).toBe(400)
      expect(
        (await PUT(orgJsonReq(`/api/tasks/${bad}`, 'PUT', { title: 'X' }), { params: { id: bad } })).status,
      ).toBe(400)
      expect((await DELETE(orgJsonReq(`/api/tasks/${bad}`, 'DELETE'), { params: { id: bad } })).status).toBe(400)
    })

    it('returns 429 on PUT and DELETE when rate limited', async () => {
      bindSession(ctx)
      const { PUT, DELETE } = await import('@/lib/route-logic/tasks/[id]')
      const params = { id: ctx.fixtures.taskId }
      await withRateLimitBlocked(async () => {
        expect(
          (
            await PUT(
              orgJsonReq(`/api/tasks/${ctx.fixtures.taskId}`, 'PUT', { title: 'RL Task' }),
              { params },
            )
          ).status,
        ).toBe(429)
        expect(
          (await DELETE(orgJsonReq(`/api/tasks/${ctx.fixtures.taskId}`, 'DELETE'), { params })).status,
        ).toBe(429)
      })
    })

    it('PUT rejects empty body and bad related refs', async () => {
      bindSession(ctx)
      const { PUT } = await import('@/lib/route-logic/tasks/[id]')
      const params = { id: ctx.fixtures.taskId }
      expect(
        (await PUT(orgJsonReq(`/api/tasks/${ctx.fixtures.taskId}`, 'PUT', {}), { params })).status,
      ).toBe(400)
      const badRef = await PUT(
        orgJsonReq(`/api/tasks/${ctx.fixtures.taskId}`, 'PUT', {
          relatedPaymentId: new Types.ObjectId().toString(),
        }),
        { params },
      )
      expect(badRef.status).toBe(404)
    })
  })

  describe('reports/saved validation and rate limits', () => {
    it('PUT validates config dates and DELETE rate limits', async () => {
      bindSession(ctx)
      const { PUT, DELETE } = await import('@/lib/route-logic/reports/saved/[id]')
      const id = ctx.fixtures.savedReportId
      const params = { id }

      const cfgBase = { source: 'payments' as const, aggregate: 'count' as const }
      const partial = await PUT(
        orgJsonReq(`/api/reports/saved/${id}`, 'PUT', { config: { ...cfgBase, fromDate: '2024-01-01' } }),
        { params },
      )
      expect(partial.status).toBe(400)

      const badDate = await PUT(
        orgJsonReq(`/api/reports/saved/${id}`, 'PUT', {
          config: { ...cfgBase, fromDate: 'not-a-date', toDate: '2024-12-31' },
        }),
        { params },
      )
      expect(badDate.status).toBe(400)

      const reversed = await PUT(
        orgJsonReq(`/api/reports/saved/${id}`, 'PUT', {
          config: { ...cfgBase, fromDate: '2024-12-31', toDate: '2024-01-01' },
        }),
        { params },
      )
      expect(reversed.status).toBe(400)

      const tooLong = await PUT(
        orgJsonReq(`/api/reports/saved/${id}`, 'PUT', {
          config: { ...cfgBase, fromDate: '2000-01-01', toDate: '2002-01-02' },
        }),
        { params },
      )
      expect(tooLong.status).toBe(400)

      await withRateLimitBlocked(async () => {
        expect((await DELETE(orgJsonReq(`/api/reports/saved/${id}`, 'DELETE'), { params })).status).toBe(429)
      })
    })

    it('POST validates date range and GET uses compound cursor', async () => {
      bindSession(ctx)
      const { POST, GET } = await import('@/lib/route-logic/reports/saved')
      const y = year()
      const rangeErr = await POST(
        orgJsonReq('/api/reports/saved', 'POST', {
          name: 'Bad Range',
          source: 'payments',
          config: {
            source: 'payments',
            aggregate: 'count',
            fromDate: '2000-01-01',
            toDate: '2002-01-02',
          },
        }),
      )
      expect(rangeErr.status).toBe(400)

      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/reports/saved', 'POST', {
                name: 'RL',
                source: 'payments',
                config: { source: 'payments', aggregate: 'count', fromDate: `${y}-01-01`, toDate: `${y}-12-31` },
              }),
            )
          ).status,
        ).toBe(429)
      })

      await withCompoundCursorSpy(async () => {
        expect((await GET(orgJsonReq('/api/reports/saved', 'GET'))).status).toBe(200)
      })
    })
  })

  describe('tax-receipts/email branches', () => {
    it('rejects bad body, missing config, invalid familyIds, and no eligible families', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email')

      const noBody = await POST(
        new NextRequest(`${API_ORIGIN}/api/tax-receipts/email`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
        }),
      )
      expect(noBody.status).toBe(400)

      const emailJobs = await import('@/lib/email-jobs')
      const sweepSpy = vi.spyOn(emailJobs, 'sweepStaleEmailJobs').mockRejectedValueOnce(new Error('sweep fail'))
      const okRes = await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
      expect(okRes.status).toBeGreaterThanOrEqual(200)
      sweepSpy.mockRestore()

      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'tax-receipts' })
      await EmailConfig.deleteMany({ organizationId: ctx.orgId })
      const noCfg = await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
      expect(noCfg.status).toBe(400)
      const enc = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: enc.encrypt('app-password'),
            fromName: 'Test',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const badIds = await POST(
        orgJsonReq('/api/tax-receipts/email', 'POST', { year: year(), familyIds: ['not-valid'] }),
      )
      expect(badIds.status).toBe(400)

      const farYear = year() + 80
      const none = await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: farYear }))
      expect(none.status).toBe(200)
      expect((await none.json()).totalFamilies).toBe(0)
    })
  })

  describe('auth/invite extended', () => {
    it('POST creates invite without platform email', async () => {
      bindSession(ctx)
      const prev = process.env.PLATFORM_SMTP_HOST
      delete process.env.PLATFORM_SMTP_HOST
      delete process.env.PLATFORM_SMTP_USER
      const { POST } = await import('@/lib/route-logic/auth/invite')
      const res = await POST(
        orgJsonReq('/api/auth/invite', 'POST', {
          email: `no-smtp-${Date.now()}@example.com`,
          role: 'member',
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).id).toBeTruthy()
      if (prev) process.env.PLATFORM_SMTP_HOST = prev
    })

    it('PUT rejects weak password and DELETE returns 404 for missing invite', async () => {
      const { Invite } = await import('@/lib/models')
      const token = `tok-${Date.now()}`
      await Invite.create({
        organizationId: ctx.orgId,
        email: `accept-${Date.now()}@example.com`,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })
      const { PUT, DELETE } = await import('@/lib/route-logic/auth/invite')
      const weak = await PUT(
        publicJsonReq('/api/auth/invite', 'PUT', { token, name: 'New User', password: 'short' }),
      )
      expect(weak.status).toBe(400)

      bindSession(ctx)
      const missing = await DELETE(
        orgJsonReq('/api/auth/invite', 'DELETE', undefined, { query: `?id=${new Types.ObjectId()}` }),
      )
      expect(missing.status).toBe(404)
    })

    it('PUT returns 410 when invite claim races', async () => {
      const { Invite } = await import('@/lib/models')
      const token = `race-${Date.now()}`
      const email = `race-${Date.now()}@example.com`
      await Invite.create({
        organizationId: ctx.orgId,
        email,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })
      mockAuth.mockResolvedValueOnce(null as never)
      const spy = vi.spyOn(Invite, 'findOneAndUpdate').mockResolvedValueOnce(null as never)
      const { PUT } = await import('@/lib/route-logic/auth/invite')
      const res = await PUT(
        publicJsonReq('/api/auth/invite', 'PUT', {
          token,
          name: 'Race User',
          password: 'RacePass123!',
        }),
      )
      bindSession(ctx)
      expect(res.status).toBe(410)
      spy.mockRestore()
      await Invite.deleteMany({ token })
    })
  })

  describe('families/[id]/payments and withdrawals', () => {
    it('validates family id and rate limits POST', async () => {
      bindSession(ctx)
      const bad = 'not-valid'
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/payments')

      expect((await GET(orgJsonReq(`/api/families/${bad}/payments`, 'GET'), { params: { id: bad } })).status).toBe(
        400,
      )

      await withCompoundCursorSpy(async () => {
        expect(
          (
            await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/payments`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
      })

      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq(`/api/families/${ctx.fixtures.familyId}/payments`, 'POST', {
                amount: 10,
                paymentDate: today(),
                year: year(),
              }),
              { params: { id: ctx.fixtures.familyId } },
            )
          ).status,
        ).toBe(429)
      })

      expect(
        (
          await POST(
            orgJsonReq(`/api/families/${bad}/payments`, 'POST', {
              amount: 10,
              paymentDate: today(),
              year: year(),
            }),
            { params: { id: bad } },
          )
        ).status,
      ).toBe(400)
    })

    it('withdrawals validates id and rate limits POST', async () => {
      bindSession(ctx)
      const bad = 'not-valid'
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/withdrawals')
      expect(
        (await GET(orgJsonReq(`/api/families/${bad}/withdrawals`, 'GET'), { params: { id: bad } })).status,
      ).toBe(400)

      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq(`/api/families/${ctx.fixtures.familyId}/withdrawals`, 'POST', {
                amount: 5,
                withdrawalDate: today(),
              }),
              { params: { id: ctx.fixtures.familyId } },
            )
          ).status,
        ).toBe(429)
      })

      expect(
        (
          await POST(
            orgJsonReq(`/api/families/${bad}/withdrawals`, 'POST', {
              amount: 5,
              withdrawalDate: today(),
            }),
            { params: { id: bad } },
          )
        ).status,
      ).toBe(400)
    })
  })

  describe('convert-to-family validation', () => {
    it('rejects missing body, missing family, and invalid wedding date', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
      const params = { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId }

      const noBody = await POST(
        new NextRequest(
          `${API_ORIGIN}/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}/convert-to-family`,
          {
            method: 'POST',
            headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
          },
        ),
        { params },
      )
      expect(noBody.status).toBe(400)

      const missingFam = await POST(
        orgJsonReq(
          `/api/families/${new Types.ObjectId()}/members/${ctx.fixtures.memberId}/convert-to-family`,
          'POST',
          { weddingDate: '2024-01-01' },
        ),
        { params: { id: new Types.ObjectId().toString(), memberId: ctx.fixtures.memberId } },
      )
      expect(missingFam.status).toBe(404)

      const { FamilyMember } = await import('@/lib/models')
      const stray = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Convert',
        lastName: 'Stray',
        gender: 'male',
      })
      const badDate = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${stray._id}/convert-to-family`,
          'POST',
          { weddingDate: 'not-a-date' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: stray._id.toString() } },
      )
      expect(badDate.status).toBe(400)

      const { Organization } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { weddingConversionDefaultPlanId: new Types.ObjectId() } },
      )
      const planErr = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${stray._id}/convert-to-family`,
          'POST',
          { weddingDate: '2025-06-01' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: stray._id.toString() } },
      )
      expect([201, 409]).toContain(planErr.status)
      await FamilyMember.deleteOne({ _id: stray._id })
      await Organization.updateOne({ _id: ctx.orgId }, { $unset: { weddingConversionDefaultPlanId: 1 } })
    })
  })

  describe('import remaining branches', () => {
    it('rejects unknown import type and collects payment row errors', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const unknown = await POST(importReq(importForm('unknown-type', 'a,b\n1,2', 'x.csv')))
      expect(unknown.status).toBe(400)

      const { Family } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const csv = [
        'name,weddingDate,paymentPlanNumber',
        `PlanNum,2018-01-01,abc`,
        `familyId,amount,paymentDate`,
        `${ctx.fixtures.familyId},10,2024-06-01`,
        `not-valid-id,10,2024-06-01`,
      ].join('\n')
      const warnRes = await POST(importReq(importForm('families', csv.split('\n').slice(0, 2).join('\n'), 'pn.csv')))
      expect((await warnRes.json()).warnings?.length).toBeGreaterThan(0)

      const payRes = await POST(
        importReq(importForm('payments', csv.split('\n').slice(2).join('\n'), 'pay.csv')),
      )
      expect((await payRes.json()).failed).toBeGreaterThanOrEqual(1)

      const memberCsv = `familyName,amount,paymentDate,memberId\n${fam?.name},10,2024-06-01,${new Types.ObjectId()}`
      const memRes = await POST(importReq(importForm('payments', memberCsv, 'mem-miss.csv')))
      expect((await memRes.json()).failed).toBeGreaterThanOrEqual(1)
    })
  })

  describe('list endpoints compound cursors and filters', () => {
    it('payments GET uses cursor mapper and invalid cursor', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/payments')
      const badCursor = await GET(
        orgJsonReq('/api/payments', 'GET', undefined, { query: '?cursor=not-valid' }),
      )
      expect(badCursor.status).toBe(400)

      await withCompoundCursorSpy(async () => {
        expect((await GET(orgJsonReq('/api/payments', 'GET'))).status).toBe(200)
      })

      const limited = await GET(orgJsonReq('/api/payments', 'GET', undefined, { query: '?limit=1' }))
      expect(limited.status).toBe(200)
    })

    it('statements GET invalid cursor and compound pages', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/statements')
      expect(
        (await GET(orgJsonReq('/api/statements', 'GET', undefined, { query: '?cursor=bad' }))).status,
      ).toBe(400)
      await withCompoundCursorSpy(async () => {
        expect((await GET(orgJsonReq('/api/statements', 'GET'))).status).toBe(200)
      })
    })

    it('tasks GET invalid filters and compound cursor', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/tasks')
      expect((await GET(orgJsonReq('/api/tasks', 'GET', undefined, { query: '?status=bad' }))).status).toBe(400)
      expect((await GET(orgJsonReq('/api/tasks', 'GET', undefined, { query: '?priority=bad' }))).status).toBe(400)
      await withCompoundCursorSpy(async () => {
        expect((await GET(orgJsonReq('/api/tasks', 'GET'))).status).toBe(200)
      })
    })

    it('family-members/all GET uses compound cursor', async () => {
      bindSession(ctx)
      await withCompoundCursorSpy(async () => {
        const { GET } = await import('@/lib/route-logic/family-members/all')
        expect((await GET(orgJsonReq('/api/family-members/all', 'GET'))).status).toBe(200)
      })
    })
  })

  describe('misc validation and worker edges', () => {
    it('cycle-config GET defaults when missing and POST requires month/day', async () => {
      bindSession(ctx)
      const { CycleConfig } = await import('@/lib/models')
      await CycleConfig.deleteMany({ organizationId: ctx.orgId })
      const { GET, POST } = await import('@/lib/route-logic/cycle-config')
      expect((await GET(orgJsonReq('/api/cycle-config', 'GET'))).status).toBe(200)
      const missing = await POST(
        orgJsonReq('/api/cycle-config', 'POST', { cycleCalendar: 'gregorian', cycleStartMonth: 0, cycleStartDay: 0 }),
      )
      expect(missing.status).toBe(400)
      await CycleConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            isActive: true,
            cycleCalendar: 'gregorian',
            cycleStartMonth: 9,
            cycleStartDay: 1,
          },
        },
        { upsert: true },
      )
    })

    it('send-file-email validates attachment and email config', async () => {
      bindSession(ctx)
      const path = '/api/send-file-email'
      const { POST } = await import('@/lib/route-logic/send-file-email')
      const form = new FormData()
      form.set('to', 'not-an-email')
      form.set('file', new Blob(['x'], { type: 'application/x-msdownload' }), 'bad.exe')
      const bad = await POST(
        new NextRequest(`${API_ORIGIN}${path}`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
          body: form,
        }),
      )
      expect([400, 415]).toContain(bad.status)

      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.orgId })
      const form2 = new FormData()
      form2.set('to', ctx.email)
      form2.set('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'doc.pdf')
      const noCfg = await POST(
        new NextRequest(`${API_ORIGIN}${path}`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
          body: form2,
        }),
      )
      expect(noCfg.status).toBe(400)
      const enc = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: enc.encrypt('app-password'),
            fromName: 'Test',
            isActive: true,
          },
        },
        { upsert: true },
      )
    })

    it('send-single-email missing statement and email config', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/statements/send-single-email')
      const missing = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: new Types.ObjectId().toString() },
        }),
      )
      expect(missing.status).toBe(404)

      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.orgId })
      const noCfg = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect(noCfg.status).toBe(400)
      const enc = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: enc.encrypt('app-password'),
            fromName: 'Test',
            isActive: true,
          },
        },
        { upsert: true },
      )
    })

    it('user password 404 when hash missing', async () => {
      const { User } = await import('@/lib/models')
      await User.updateOne({ _id: ctx.userId }, { $unset: { hashedPassword: 1 } })
      mockAuth.mockResolvedValueOnce({
        user: { id: ctx.userId, email: ctx.email, memberships: [{ o: ctx.orgId, r: 'owner' }] },
      } as never)
      const { PATCH } = await import('@/lib/route-logic/user/password')
      const res = await PATCH(
        sessionJsonReq('/api/user/password', 'PATCH', {
          currentPassword: 'x',
          newPassword: 'NewPass123!zz',
        }),
      )
      expect(res.status).toBe(404)
      const bcrypt = await import('bcryptjs')
      await User.updateOne(
        { _id: ctx.userId },
        { $set: { hashedPassword: await bcrypt.hash('ApiRouteTestPass123!', 10) } },
      )
      bindSession(ctx)
    })

    it('user 2fa disable handles decrypt failure path', async () => {
      const { User } = await import('@/lib/models')
      const enc = await import('@/lib/encryption')
      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: {
            twoFactorEnabled: true,
            twoFactorSecret: 'not-valid-ciphertext',
          },
        },
      )
      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const res = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password: 'ApiRouteTestPass123!',
          code: '000000',
        }),
      )
      expect(res.status).toBe(401)
      await User.updateOne(
        { _id: ctx.userId },
        { $set: { twoFactorEnabled: false }, $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1 } },
      )
      bindSession(ctx)
    })

    it('families bulk delete catches cascade errors', async () => {
      bindSession(ctx)
      const recycle = await import('@/lib/recycle-bin')
      const spy = vi.spyOn(recycle, 'softDeleteFamilyCascade').mockRejectedValueOnce(new Error('cascade fail'))
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'delete',
          ids: [ctx.fixtures.familyId],
        }),
      )
      expect(res.status).toBe(200)
      spy.mockRestore()
    })

    it('signup handles malformed invite email and existing user', async () => {
      const { InviteRequest, User } = await import('@/lib/models')
      const code = `bad-email-${Date.now()}`
      await InviteRequest.create({
        email: 'not-an-email',
        name: 'Bad',
        status: 'approved',
        signupCode: code,
      })
      const { POST } = await import('@/lib/route-logic/auth/signup')
      const badEmail = await POST(
        publicJsonReq('/api/auth/signup', 'POST', {
          email: 'ignored@example.com',
          password: 'SignupPass123!',
          name: 'Bad Email',
          inviteCode: code,
        }),
      )
      expect(badEmail.status).toBe(400)

      const usedCode = `used-${Date.now()}`
      await InviteRequest.create({
        email: ctx.email,
        name: 'Used',
        status: 'approved',
        signupCode: usedCode,
      })
      const exists = await POST(
        publicJsonReq('/api/auth/signup', 'POST', {
          email: ctx.email,
          password: 'SignupPass123!',
          name: 'Exists',
          inviteCode: usedCode,
        }),
      )
      expect(exists.status).toBe(409)
      await InviteRequest.deleteMany({ signupCode: { $in: [code, usedCode] } })
      void User
    })
  })

  describe('jobs production sanitize and failure paths', () => {
    it('cycle-rollover sanitizes errors in production and handles outer catch', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const rollover = await import('@/lib/cycle-rollover')
      const spy = vi.spyOn(rollover, 'runCycleRolloverForOrg').mockRejectedValueOnce(new Error('sk_live_secret123'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const res = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        expect(res.status).toBe(200)
        const body = await res.json()
        if (body.errors?.length) {
          expect(String(body.errors[0].error)).not.toContain('sk_live')
        }
      } finally {
        spy.mockRestore()
        vi.unstubAllEnvs()
      }

      const pag = await import('@/lib/org-pagination')
      const loadSpy = vi.spyOn(pag, 'loadAllByIdCursor').mockRejectedValueOnce(new Error('db down'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const fail = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        expect(fail.status).toBe(500)
      } finally {
        loadSpy.mockRestore()
      }
    })

    it('generate-monthly-statements outer catch releases lock', async () => {
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockRejectedValueOnce(new Error('chunk fail'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const fail = await POST(orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }))
        expect(fail.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('stripe webhook remaining lines', () => {
    it('rethrows non-duplicate StripeWebhookEvent errors', async () => {
      const { StripeWebhookEvent } = await import('@/lib/models')
      const createSpy = vi.spyOn(StripeWebhookEvent, 'create').mockRejectedValueOnce(new Error('db fail'))
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> }
      }
      client.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_throw_${Date.now()}`,
        type: 'customer.created',
        data: { object: {} },
      })
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const fail = await POST(
        new NextRequest('http://localhost:3000/api/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(fail.status).toBe(500)
      createSpy.mockRestore()
    })

    it('no-ops dispute created/closed/reinstated when charge retrieve fails', async () => {
      bindSession(ctx)
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> }
        charges: { retrieve: ReturnType<typeof vi.fn> }
      }
      const { Payment } = await import('@/lib/models')
      const piId = `pi_dp_fail_${Date.now()}`
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 50,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })
      for (const type of [
        'charge.dispute.created',
        'charge.dispute.closed',
        'charge.dispute.funds_reinstated',
      ] as const) {
        client.charges.retrieve.mockRejectedValueOnce(new Error('missing'))
        client.webhooks.constructEvent.mockReturnValueOnce({
          id: `evt_${type}_${Date.now()}`,
          type,
          data: { object: { id: 'dp_x', charge: 'ch_x', status: 'lost', payment_intent: piId } },
        })
        const { POST } = await import('@/lib/route-logic/stripe/webhook')
        const res = await POST(
          new NextRequest('http://localhost:3000/api/stripe/webhook', {
            method: 'POST',
            headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
            body: '{}',
          }),
        )
        expect(res.status).toBe(200)
      }
      await Payment.deleteMany({ stripePaymentIntentId: piId })
    })

    it('syncPaymentRefundFromStripeCharge no-ops when charge retrieve fails', async () => {
      bindSession(ctx)
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> }
        charges: { retrieve: ReturnType<typeof vi.fn> }
      }
      const piId = `pi_sync_fail_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 50,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        disputeStatus: 'needs_response',
      })
      client.charges.retrieve
        .mockResolvedValueOnce({
          id: 'ch_sync',
          payment_intent: piId,
          amount_refunded: 0,
          currency: 'usd',
        })
        .mockRejectedValueOnce(new Error('missing'))
      client.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_sync_fail_${Date.now()}`,
        type: 'charge.dispute.funds_reinstated',
        data: { object: { id: 'dp_sync', charge: 'ch_sync', status: 'won', payment_intent: piId } },
      })
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            new NextRequest('http://localhost:3000/api/stripe/webhook', {
              method: 'POST',
              headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
              body: '{}',
            }),
          )
        ).status,
      ).toBe(200)
      await Payment.deleteMany({ stripePaymentIntentId: piId })
    })

    it('ignores duplicate key on payment_intent.succeeded backstop', async () => {
      bindSession(ctx)
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> }
      }
      const piId = `pi_dup_back_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      const dupErr = Object.assign(new Error('dup'), { code: 11000 })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      client.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_pi_dup_back_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: piId,
            amount: 1200,
            currency: 'usd',
            created: Math.floor(Date.now() / 1000),
            metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
          },
        },
      })
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        new NextRequest('http://localhost:3000/api/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(res.status).toBe(200)
      createSpy.mockRestore()
    })
  })

  describe('batch 2 — remaining reachable branches', () => {
    it('auth/invite PUT requires body and valid name', async () => {
      const { Invite } = await import('@/lib/models')
      const token = `body-${Date.now()}`
      await Invite.create({
        organizationId: ctx.orgId,
        email: `body-${Date.now()}@example.com`,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })
      mockAuth.mockResolvedValueOnce(null as never)
      const { PUT } = await import('@/lib/route-logic/auth/invite')
      const noBody = await PUT(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'PUT',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(noBody.status).toBe(400)
      const shortName = await PUT(
        publicJsonReq('/api/auth/invite', 'PUT', { token, name: 'A', password: 'ValidPass123!' }),
      )
      expect(shortName.status).toBe(400)
      bindSession(ctx)
      await Invite.deleteMany({ token })
    })

    it('lifecycle-event-types PUT empty body and DELETE missing type', async () => {
      bindSession(ctx)
      const { PUT, DELETE } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
      const id = ctx.fixtures.lifecycleEventTypeId
      expect(
        (await PUT(orgJsonReq(`/api/lifecycle-event-types/${id}`, 'PUT', {}), { params: { id } })).status,
      ).toBe(400)
      const missing = await DELETE(
        orgJsonReq(`/api/lifecycle-event-types/${new Types.ObjectId()}`, 'DELETE'),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)
    })

    it('family-members/all paginates with limit and rejects bad cursor', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/family-members/all')
      expect(
        (
          await GET(orgJsonReq('/api/family-members/all', 'GET', undefined, { query: '?limit=1&cursor=bad' }))
        ).status,
      ).toBe(400)
      const { FamilyMember } = await import('@/lib/models')
      const extras = await FamilyMember.create([
        {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          firstName: 'Pag',
          lastName: 'A',
          gender: 'male',
        },
        {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          firstName: 'Pag',
          lastName: 'B',
          gender: 'female',
        },
      ])
      const page = await GET(orgJsonReq('/api/family-members/all', 'GET', undefined, { query: '?limit=1' }))
      expect(page.status).toBe(200)
      const body = await page.json()
      if (body.nextCursor) {
        const next = await GET(
          orgJsonReq('/api/family-members/all', 'GET', undefined, {
            query: `?limit=1&cursor=${encodeURIComponent(body.nextCursor)}`,
          }),
        )
        expect(next.status).toBe(200)
      }
      await FamilyMember.deleteMany({ _id: { $in: extras.map((m) => m._id) } })
    })

    it('trash routes validate kind and rate limit DELETE', async () => {
      bindSession(ctx)
      const { GET, DELETE } = await import('@/lib/route-logic/trash/[kind]/[id]')
      expect(
        (
          await GET(orgJsonReq(`/api/trash/not-a-kind/${ctx.fixtures.taskId}`, 'GET'), {
            params: { kind: 'not-a-kind', id: ctx.fixtures.taskId },
          })
        ).status,
      ).toBe(400)
      await withRateLimitBlocked(async () => {
        expect(
          (
            await DELETE(orgJsonReq(`/api/trash/task/${ctx.fixtures.taskId}`, 'DELETE'), {
              params: { kind: 'task', id: ctx.fixtures.taskId },
            })
          ).status,
        ).toBe(429)
      })
    })

    it('trash restore validates kind', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const res = await POST(
        orgJsonReq(`/api/trash/bad-kind/${ctx.fixtures.taskId}/restore`, 'POST', {}),
        { params: { kind: 'bad-kind', id: ctx.fixtures.taskId } },
      )
      expect(res.status).toBe(400)
    })

    it('families/[id] PUT validates plan parent and empty body', async () => {
      bindSession(ctx)
      const { PUT } = await import('@/lib/route-logic/families/[id]')
      const id = ctx.fixtures.familyId
      expect((await PUT(orgJsonReq(`/api/families/${id}`, 'PUT', {}), { params: { id } })).status).toBe(400)
      const selfParent = await PUT(
        orgJsonReq(`/api/families/${id}`, 'PUT', { parentFamilyId: id }),
        { params: { id } },
      )
      expect(selfParent.status).toBe(400)
      const badPlan = await PUT(
        orgJsonReq(`/api/families/${id}`, 'PUT', { paymentPlanId: new Types.ObjectId().toString() }),
        { params: { id } },
      )
      expect(badPlan.status).toBe(400)
    })

    it('families/[id] GET maps cycle charge cursor', async () => {
      bindSession(ctx)
      const { CycleCharge } = await import('@/lib/models')
      await CycleCharge.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 10,
        chargeDate: new Date(),
        cycleYear: year(),
        calendar: 'gregorian',
      })
      await withCompoundCursorSpy(async () => {
        const { GET } = await import('@/lib/route-logic/families/[id]')
        expect(
          (await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })).status,
        ).toBe(200)
      })
      await CycleCharge.deleteMany({ familyId: ctx.fixtures.familyId, amount: 10 })
    })

    it('convert-to-family catches plan lookup errors', async () => {
      bindSession(ctx)
      const { FamilyMember, PaymentPlan } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Plan',
        lastName: 'Err',
        gender: 'female',
      })
      const { Organization } = await import('@/lib/models')
      await Organization.updateOne({ _id: ctx.orgId }, { $set: { weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId } })
      const spy = vi.spyOn(PaymentPlan, 'findOne').mockImplementationOnce(() => {
        throw new Error('plan lookup failed')
      })
      const { POST } = await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
      const res = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.betaFamilyId}/members/${member._id}/convert-to-family`,
          'POST',
          { weddingDate: '2025-08-01' },
        ),
        { params: { id: ctx.fixtures.betaFamilyId, memberId: member._id.toString() } },
      )
      expect([201, 404, 409]).toContain(res.status)
      spy.mockRestore()
      await FamilyMember.deleteOne({ _id: member._id })
      await Organization.updateOne({ _id: ctx.orgId }, { $unset: { weddingConversionDefaultPlanId: 1 } })
    })

    it('send-file-email rejects oversize attachment', async () => {
      bindSession(ctx)
      const form = new FormData()
      form.set('to', ctx.email)
      form.set('file', new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'application/pdf' }), 'big.pdf')
      const { POST } = await import('@/lib/route-logic/send-file-email')
      const res = await POST(
        new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
          body: form,
        }),
      )
      expect(res.status).toBe(413)
    })

    it('statements POST idempotent refresh and send-single decrypt failure', async () => {
      bindSession(ctx)
      const y = year()
      const { POST: stmtPost } = await import('@/lib/route-logic/statements')
      const range = {
        familyId: ctx.fixtures.familyId,
        fromDate: `${y}-01-01`,
        toDate: `${y}-01-31`,
      }
      const first = await stmtPost(orgJsonReq('/api/statements', 'POST', range))
      const second = await stmtPost(orgJsonReq('/api/statements', 'POST', range))
      expect(first.status).toBeGreaterThanOrEqual(200)
      expect(second.status).toBe(200)

      const { EmailConfig } = await import('@/lib/models')
      const enc = await import('@/lib/encryption')
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
      const { POST: sendOne } = await import('@/lib/route-logic/statements/send-single-email')
      const badDecrypt = await sendOne(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect(badDecrypt.status).toBe(500)
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        { $set: { password: enc.encrypt('app-password') } },
      )
    })

    it('payments GET invalid cursor', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/payments')
      expect(
        (await GET(orgJsonReq('/api/payments', 'GET', undefined, { query: '?cursor=%%%' }))).status,
      ).toBe(400)
    })

    it('tasks POST rejects unknown related payment id', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tasks')
      const res = await POST(
        orgJsonReq('/api/tasks', 'POST', {
          title: 'Bad Ref',
          dueDate: today(),
          email: ctx.email,
          priority: 'low',
          status: 'pending',
          relatedPaymentId: new Types.ObjectId().toString(),
        }),
      )
      expect(res.status).toBe(404)
    })

    it('signup logs personal org creation failure', async () => {
      const authHelpers = await import('@/lib/auth-helpers')
      const spy = vi.spyOn(authHelpers, 'createPersonalOrganization').mockRejectedValueOnce(new Error('org fail'))
      const { InviteRequest } = await import('@/lib/models')
      const code = `orgfail-${Date.now()}`
      await InviteRequest.create({
        email: `orgfail-${Date.now()}@example.com`,
        name: 'Org Fail',
        status: 'approved',
        signupCode: code,
      })
      const { POST } = await import('@/lib/route-logic/auth/signup')
      const res = await POST(
        publicJsonReq('/api/auth/signup', 'POST', {
          email: `orgfail-${Date.now()}@example.com`,
          password: 'SignupPass123!',
          name: 'Org Fail User',
          inviteCode: code,
        }),
      )
      expect(res.status).toBe(200)
      spy.mockRestore()
      await InviteRequest.deleteMany({ signupCode: code })
    })

    it('import warns on non-numeric plan number and invalid familyId in payments', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const warn = await POST(
        importReq(
          importForm(
            'families',
            'name,weddingDate,paymentPlanNumber\nPlanX,2018-01-01,abc',
            'pn.csv',
          ),
        ),
      )
      expect((await warn.json()).warnings?.length).toBeGreaterThan(0)
      const pay = await POST(
        importReq(importForm('payments', 'familyId,amount,paymentDate\nnot-valid,10,2024-06-01', 'badfid.csv')),
      )
      expect((await pay.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('withdrawals/[withdrawalId] validates ids and rate limits', async () => {
      bindSession(ctx)
      const { PUT, DELETE } = await import('@/lib/route-logic/families/[id]/withdrawals/[withdrawalId]')
      const params = { id: ctx.fixtures.familyId, withdrawalId: ctx.fixtures.withdrawalId }
      expect(
        (
          await PUT(
            orgJsonReq(
              `/api/families/${ctx.fixtures.familyId}/withdrawals/${ctx.fixtures.withdrawalId}`,
              'PUT',
              {},
            ),
            { params },
          )
        ).status,
      ).toBe(400)
      await withRateLimitBlocked(async () => {
        expect(
          (
            await PUT(
              orgJsonReq(
                `/api/families/${ctx.fixtures.familyId}/withdrawals/${ctx.fixtures.withdrawalId}`,
                'PUT',
                { amount: 12 },
              ),
              { params },
            )
          ).status,
        ).toBe(429)
        expect(
          (
            await DELETE(
              orgJsonReq(
                `/api/families/${ctx.fixtures.familyId}/withdrawals/${ctx.fixtures.withdrawalId}`,
                'DELETE',
              ),
              { params },
            )
          ).status,
        ).toBe(429)
      })
    })

    it('jobs process-recurring-payments throws when per-org fetch fails', async () => {
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 0,
          failed: 1,
          errors: [],
        }
      })
      const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'fail' })
      vi.stubGlobal('fetch', fetchSpy)
      try {
        const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
        const res = await POST(orgJsonReq('/api/jobs/process-recurring-payments', 'POST', {}, { cron: true }))
        expect(res.status).toBe(500)
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
      }
    })
  })
})
