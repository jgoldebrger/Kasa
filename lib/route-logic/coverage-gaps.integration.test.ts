/**
 * Targeted lib/route-logic line-coverage gaps not hit elsewhere.
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

function importForm(
  type: string,
  csv: string,
  filename: string,
  extra?: Record<string, string>,
): FormData {
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

describe.sequential('route-logic coverage gaps', () => {
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

  describe('import POST branches', () => {
    it('imports via XLSX and covers parseXlsx path', async () => {
      bindSession(ctx)
      const ExcelJS = await import('exceljs')
      const mod = ExcelJS.default ?? ExcelJS
      const wb = new mod.Workbook()
      const ws = wb.addWorksheet('Families')
      ws.addRow(['name', 'weddingDate'])
      ws.addRow([`Xlsx Gap ${Date.now()}`, '2019-03-01'])
      const buf = await wb.xlsx.writeBuffer()
      const form = new FormData()
      form.set('type', 'families')
      form.set(
        'file',
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'families.xlsx',
      )
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(importReq(form))
      expect(res.status).toBe(200)
      expect((await res.json()).imported).toBeGreaterThanOrEqual(1)
    })

    it('rejects invalid bound memberId format', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(
        importReq(
          importForm('members', 'firstName,lastName\nA,B', 'm.csv', {
            familyId: ctx.fixtures.familyId,
            memberId: 'not-valid',
          }),
        ),
      )
      expect(res.status).toBe(400)
    })

    it('rejects member import when familyId belongs to another org', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const otherId = new Types.ObjectId().toString()
      const res = await POST(
        importReq(
          importForm('members', `familyId,firstName,lastName\n${otherId},X,Y`, 'wrong-org.csv'),
        ),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('rejects payment import when familyId belongs to another org', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const otherId = new Types.ObjectId().toString()
      const res = await POST(
        importReq(
          importForm(
            'payments',
            `familyId,amount,paymentDate\n${otherId},10,2024-06-01`,
            'pay-wrong-org.csv',
          ),
        ),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('rejects payment when member is not in family', async () => {
      bindSession(ctx)
      const { FamilyMember } = await import('@/lib/models')
      const otherMember = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Other',
        lastName: 'Fam',
      })
      const { Family } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(
        importReq(
          importForm(
            'payments',
            `familyName,amount,paymentDate,memberId\n${fam?.name},10,2024-06-01,${otherMember._id}`,
            'pay-wrong-member.csv',
          ),
        ),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
      await FamilyMember.deleteOne({ _id: otherMember._id })
    })

    it('warns on invalid paymentPlanId and non-numeric plan number', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const csv = [
        'name,weddingDate,paymentPlanId,paymentPlanNumber',
        `Warn Plan A,2018-01-01,${new Types.ObjectId()},abc`,
      ].join('\n')
      const res = await POST(importReq(importForm('families', csv, 'plan-warn.csv')))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.warnings?.length).toBeGreaterThan(0)
    })

    it('collects lifecycle errors for missing event type and bad event date', async () => {
      bindSession(ctx)
      const { Family } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const name = fam?.name ?? 'API Route Marker Family'
      const { POST } = await import('@/lib/route-logic/import')

      const noType = await POST(
        importReq(
          importForm(
            'lifecycle-events',
            `familyName,eventDate,amount\n${name},2024-08-01,50`,
            'le-no-type.csv',
          ),
        ),
      )
      expect((await noType.json()).failed).toBeGreaterThanOrEqual(1)

      const badDate = await POST(
        importReq(
          importForm(
            'lifecycle-events',
            `familyName,eventType,eventDate,amount\n${name},bar_mitzvah,not-a-date,50`,
            'le-bad-date.csv',
          ),
        ),
      )
      expect((await badDate.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('rejects lifecycle amount when event type has invalid configured amount', async () => {
      bindSession(ctx)
      const { Family, LifecycleEvent } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const type = `bad_amt_${Date.now()}`
      const ev = await LifecycleEvent.create({
        organizationId: ctx.orgId,
        type,
        name: 'Bad Amount',
        amount: 1,
      })
      await LifecycleEvent.collection.updateOne({ _id: ev._id }, { $set: { amount: -1 } })
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(
        importReq(
          importForm(
            'lifecycle-events',
            `familyName,eventType,eventDate\n${fam?.name},${type},2024-08-01`,
            'le-bad-amt.csv',
          ),
        ),
      )
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
      await LifecycleEvent.deleteOne({ _id: ev._id })
    })

    it('records errors when member and payment create throw', async () => {
      bindSession(ctx)
      const { FamilyMember, Payment, Family } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const { POST } = await import('@/lib/route-logic/import')

      const memberSpy = vi
        .spyOn(FamilyMember, 'create')
        .mockRejectedValueOnce(new Error('member db fail'))
      const memberRes = await POST(
        importReq(
          importForm(
            'members',
            `familyName,firstName,lastName\n${fam?.name},Throw,Member`,
            'mem-throw.csv',
          ),
        ),
      )
      expect((await memberRes.json()).failed).toBeGreaterThanOrEqual(1)
      memberSpy.mockRestore()

      const paySpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(new Error('payment db fail'))
      const payRes = await POST(
        importReq(
          importForm(
            'payments',
            `familyName,amount,paymentDate\n${fam?.name},10,2024-06-01`,
            'pay-throw.csv',
          ),
        ),
      )
      expect((await payRes.json()).failed).toBeGreaterThanOrEqual(1)
      paySpy.mockRestore()
    })
  })

  describe('email workers edge paths', () => {
    async function seedEmailConfig() {
      const { EmailConfig } = await import('@/lib/models')
      const enc = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
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

    it('returns 429 when statement worker is rate limited', async () => {
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/statements/send-emails/worker', 'POST', {
                jobId: ctx.fixtures.familyId,
              }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('returns 429 when tax receipt worker is rate limited', async () => {
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/tax-receipts/email/worker', 'POST', {
                jobId: ctx.fixtures.familyId,
              }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('requires organizationId for cron statement worker', async () => {
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq(
          '/api/statements/send-emails/worker',
          'POST',
          { jobId: ctx.fixtures.familyId },
          { cron: true },
        ),
      )
      expect(res.status).toBe(400)
    })

    it('requires organizationId for cron tax worker', async () => {
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq(
          '/api/tax-receipts/email/worker',
          'POST',
          { jobId: ctx.fixtures.familyId },
          { cron: true },
        ),
      )
      expect(res.status).toBe(400)
    })

    it('fails tax worker when password decrypt fails', async () => {
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
        status: 'queued',
        year: year(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect((await res.json()).status).toBe('failed')
      await seedEmailConfig()
      await EmailJob.deleteOne({ _id: job._id })
    })

    it('logs continuation warning when CRON_SECRET missing', async () => {
      await seedEmailConfig()
      const prev = process.env.CRON_SECRET
      delete process.env.CRON_SECRET
      const { Family, EmailJob } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const spy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValue({ ok: true, email: null })
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
      vi.stubGlobal('fetch', fetchSpy)

      try {
        const familyIds = await Promise.all(
          [0, 1, 2, 3].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Gap Tax ${i} ${Date.now()}`,
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
          totalFamilies: familyIds.length,
          pending: familyIds.map((f) => f._id),
        })
        const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
        const res = await POST(
          orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        expect(fetchSpy).toHaveBeenCalled()
        await EmailJob.deleteOne({ _id: job._id })
        await Family.deleteMany({ _id: { $in: familyIds.map((f) => f._id) } })
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
        if (prev) process.env.CRON_SECRET = prev
        else process.env.CRON_SECRET = 'test-cron-secret'
      }
    })

    it('logs continuation HTTP errors for statement worker', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const spy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValue({ ok: true, email: null })
      const fetchSpy = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, text: async () => 'fail' })
      vi.stubGlobal('fetch', fetchSpy)

      try {
        const familyIds = await Promise.all(
          [0, 1, 2, 3, 4, 5].map((i) =>
            Family.create({
              organizationId: ctx.orgId,
              name: `Gap Stmt ${i} ${Date.now()}`,
              weddingDate: new Date('2010-01-01'),
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
          totalFamilies: familyIds.length,
          pending: familyIds.map((f) => f._id),
        })
        const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
        const res = await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        await new Promise((r) => setTimeout(r, 50))
        expect(fetchSpy).toHaveBeenCalled()
        await EmailJob.deleteOne({ _id: job._id })
        await Family.deleteMany({ _id: { $in: familyIds.map((f) => f._id) } })
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
      }
    })
  })

  describe('families/[id] validation and member role view', () => {
    it('rejects invalid family id on GET PUT DELETE', async () => {
      bindSession(ctx)
      const bad = 'not-valid'
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/families/[id]')
      expect(
        (await GET(orgJsonReq(`/api/families/${bad}`, 'GET'), { params: { id: bad } })).status,
      ).toBe(400)
      expect(
        (
          await PUT(orgJsonReq(`/api/families/${bad}`, 'PUT', { name: 'X' }), {
            params: { id: bad },
          })
        ).status,
      ).toBe(400)
      expect(
        (await DELETE(orgJsonReq(`/api/families/${bad}`, 'DELETE'), { params: { id: bad } }))
          .status,
      ).toBe(400)
    })

    it('rejects parent family not in org on PUT', async () => {
      bindSession(ctx)
      const { PUT } = await import('@/lib/route-logic/families/[id]')
      const res = await PUT(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'PUT', {
          parentFamilyId: new Types.ObjectId().toString(),
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })

    it('returns member-scoped family detail without financial fields', async () => {
      bindSession(ctx, 'member')
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)
      const { GET } = await import('@/lib/route-logic/families/[id]')
      const res = await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
        params: { id: ctx.fixtures.familyId },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.family.openBalance).toBeUndefined()
      expect(body.payments).toEqual([])
      bindSession(ctx)
    })

    it('invokes compound cursor mappers on admin family GET', async () => {
      bindSession(ctx)
      const pag = await import('@/lib/pagination')
      const orig = pag.collectCompoundCursorPages
      const spy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementationOnce(
          async (loadPage, baseFilter, _sortField, _direction, getCursor, _batchSize) => {
            const page = await loadPage(baseFilter, 3)
            if (page[0]) getCursor(page[0] as never)
            return page
          },
        )
      try {
        const { GET } = await import('@/lib/route-logic/families/[id]')
        expect(
          (
            await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
        void orig
      }
    })
  })

  describe('saved-payment-methods and charge-saved-card', () => {
    it('returns 429 on GET POST DELETE saved payment methods', async () => {
      bindSession(ctx)
      const path = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { GET, POST, DELETE } =
        await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      await withRateLimitBlocked(async () => {
        expect(
          (await GET(orgJsonReq(path, 'GET'), { params: { id: ctx.fixtures.familyId } })).status,
        ).toBe(429)
        expect(
          (
            await POST(
              orgJsonReq(path, 'POST', {
                paymentMethodId: 'pm_test123',
                paymentIntentId: 'pi_test123',
              }),
              {
                params: { id: ctx.fixtures.familyId },
              },
            )
          ).status,
        ).toBe(429)
        expect(
          (
            await DELETE(
              orgJsonReq(`${path}?paymentMethodId=${ctx.fixtures.savedPaymentMethodId}`, 'DELETE'),
              { params: { id: ctx.fixtures.familyId } },
            )
          ).status,
        ).toBe(429)
      })
    })

    it('validates POST body and payment method ownership', async () => {
      bindSession(ctx)
      const path = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')

      const noBody = await POST(
        new NextRequest(`${API_ORIGIN}${path}`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(noBody.status).toBe(400)

      const missingFam = await POST(
        orgJsonReq(`/api/families/${new Types.ObjectId()}/saved-payment-methods`, 'POST', {
          paymentMethodId: 'pm_test123',
          paymentIntentId: 'pi_test123',
        }),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missingFam.status).toBe(404)

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
        paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        status: 'succeeded',
        payment_method: 'pm_other',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      const mismatch = await POST(
        orgJsonReq(path, 'POST', {
          paymentMethodId: 'pm_test123',
          paymentIntentId: 'pi_test123',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(mismatch.status).toBe(403)
    })

    it('DELETE validates paymentMethodId query param', async () => {
      bindSession(ctx)
      const { DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const base = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      expect(
        (await DELETE(orgJsonReq(base, 'DELETE'), { params: { id: ctx.fixtures.familyId } }))
          .status,
      ).toBe(400)
      expect(
        (
          await DELETE(orgJsonReq(`${base}?paymentMethodId=bad`, 'DELETE'), {
            params: { id: ctx.fixtures.familyId },
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await DELETE(orgJsonReq(`${base}?paymentMethodId=${new Types.ObjectId()}`, 'DELETE'), {
            params: { id: ctx.fixtures.familyId },
          })
        ).status,
      ).toBe(404)
    })

    it('charge-saved-card rejects missing family and invalid memberId', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const missingFam = await POST(
        orgJsonReq(`/api/families/${new Types.ObjectId()}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 5,
        }),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missingFam.status).toBe(404)

      const badMember = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 5,
          memberId: 'not-valid',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(badMember.status).toBe(400)
    })
  })

  describe('families/[id]/members/[memberId] extended PUT', () => {
    it('updates optional spouse and address fields', async () => {
      bindSession(ctx)
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const res = await PUT(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}`,
          'PUT',
          {
            firstName: 'Updated',
            lastName: 'Member',
            birthDate: '2010-01-01',
            gender: 'male',
            hebrewFirstName: 'ע',
            hebrewLastName: 'ב',
            spouseFirstName: 'Sp',
            spouseHebrewName: 'ש',
            spouseFatherHebrewName: 'א',
            spouseCellPhone: '555-0100',
            phone: '555-0200',
            email: 'm@example.com',
            address: '1 Main',
            city: 'Town',
            state: 'NY',
            zip: '10001',
            weddingDate: '2030-06-01',
            spouseName: 'Spouse',
          },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId } },
      )
      expect(res.status).toBe(200)
    })

    it('returns 429 on PUT and DELETE', async () => {
      bindSession(ctx)
      const { PUT, DELETE } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const params = { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId }
      await withRateLimitBlocked(async () => {
        expect(
          (
            await PUT(
              orgJsonReq(
                `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}`,
                'PUT',
                { firstName: 'A', lastName: 'B', birthDate: '2010-01-01', gender: 'male' },
              ),
              { params },
            )
          ).status,
        ).toBe(429)
        expect(
          (
            await DELETE(
              orgJsonReq(
                `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}`,
                'DELETE',
              ),
              {
                params,
              },
            )
          ).status,
        ).toBe(429)
      })
    })
  })

  describe('stripe confirm-payment and recurring process', () => {
    it('returns 500 when stripe is not configured', async () => {
      bindSession(ctx)
      const prev = process.env.STRIPE_SECRET_KEY
      delete process.env.STRIPE_SECRET_KEY
      vi.resetModules()
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_test123',
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(res.status).toBe(500)
      process.env.STRIPE_SECRET_KEY = prev ?? 'sk_test'
      vi.resetModules()
    })

    it('requires familyId and rate limits confirm-payment', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const noFam = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', { paymentIntentId: 'pi_test123' }),
      )
      expect(noFam.status).toBe(400)
      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/stripe/confirm-payment', 'POST', {
                paymentIntentId: 'pi_test123',
                familyId: ctx.fixtures.familyId,
              }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('recurring GET validates familyId and rate limits', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/recurring-payments/process')
      const bad = await GET(
        orgJsonReq('/api/recurring-payments/process', 'GET', undefined, { query: '?familyId=bad' }),
      )
      expect(bad.status).toBe(400)
      const missing = await GET(
        orgJsonReq('/api/recurring-payments/process', 'GET', undefined, {
          query: `?familyId=${new Types.ObjectId()}`,
        }),
      )
      expect(missing.status).toBe(404)
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/recurring-payments/process', 'GET'))).status).toBe(429)
      })
    })

    it('recurring POST returns no-due message when nothing to process', async () => {
      bindSession(ctx)
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.updateMany(
        { organizationId: ctx.orgId },
        { $set: { isActive: false } },
      )
      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.processed).toBe(0)
      await RecurringPayment.updateMany({ organizationId: ctx.orgId }, { $set: { isActive: true } })
    })
  })

  describe('user/2fa setup extended', () => {
    it('returns 429 and handles missing password hash', async () => {
      const { User } = await import('@/lib/models')
      await User.updateOne({ _id: ctx.userId }, { $unset: { hashedPassword: 1 } })
      mockAuth.mockResolvedValueOnce({
        user: { id: ctx.userId, email: ctx.email, memberships: [{ o: ctx.orgId, r: 'owner' }] },
      } as never)
      const { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const res = await POST(sessionJsonReq('/api/user/2fa/setup', 'POST', { password: 'x' }))
      expect(res.status).toBe(500)
      const bcrypt = await import('bcryptjs')
      await User.updateOne(
        { _id: ctx.userId },
        { $set: { hashedPassword: await bcrypt.hash('ApiRouteTestPass123!', 10) } },
      )
      bindSession(ctx)

      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              sessionJsonReq('/api/user/2fa/setup', 'POST', { password: 'ApiRouteTestPass123!' }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('uses membership org label when lastActiveOrganizationId absent', async () => {
      const { User } = await import('@/lib/models')
      await User.updateOne({ _id: ctx.userId }, { $unset: { lastActiveOrganizationId: 1 } })
      const { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const res = await POST(
        sessionJsonReq('/api/user/2fa/setup', 'POST', { password: 'ApiRouteTestPass123!' }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).otpauthUrl).toContain('otpauth://')
      bindSession(ctx)
    })
  })

  describe('remaining rate-limit 429 one-liners', () => {
    const cases: Array<{ name: string; run: () => Promise<Response> }> = [
      {
        name: 'cycle-config GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/cycle-config')
          return GET(orgJsonReq('/api/cycle-config', 'GET'))
        },
      },
      {
        name: 'payments GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/payments')
          return GET(orgJsonReq('/api/payments', 'GET'))
        },
      },
      {
        name: 'statements send-emails POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/send-emails')
          return POST(
            orgJsonReq('/api/statements/send-emails', 'POST', {
              fromDate: `${year()}-01-01`,
              toDate: `${year()}-12-31`,
            }),
          )
        },
      },
      {
        name: 'tax-receipts GET single family filter',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tax-receipts')
          return GET(
            orgJsonReq('/api/tax-receipts', 'GET', undefined, {
              query: `?year=${year()}&familyId=${ctx.fixtures.familyId}`,
            }),
          )
        },
      },
      {
        name: 'user password PATCH',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/user/password')
          return PATCH(
            sessionJsonReq('/api/user/password', 'PATCH', {
              currentPassword: 'wrong',
              newPassword: 'NewPass123!zz',
            }),
          )
        },
      },
      {
        name: 'tasks id GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tasks/[id]')
          return GET(orgJsonReq(`/api/tasks/${ctx.fixtures.taskId}`, 'GET'), {
            params: { id: ctx.fixtures.taskId },
          })
        },
      },
      {
        name: 'send-file-email POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/send-file-email')
          return POST(
            orgJsonReq('/api/send-file-email', 'POST', { to: ctx.email, subject: 'x', body: 'y' }),
          )
        },
      },
      {
        name: 'statements POST create',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements')
          return POST(
            orgJsonReq('/api/statements', 'POST', {
              familyId: ctx.fixtures.familyId,
              fromDate: `${year()}-01-01`,
              toDate: today(),
            }),
          )
        },
      },
      {
        name: 'tasks POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/tasks')
          return POST(
            orgJsonReq('/api/tasks', 'POST', {
              title: 'Gap',
              dueDate: today(),
              email: ctx.email,
              priority: 'low',
              status: 'pending',
            }),
          )
        },
      },
      {
        name: 'admin invite-requests PATCH',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/admin/invite-requests')
          return PATCH(
            orgJsonReq('/api/admin/invite-requests', 'PATCH', {
              id: ctx.fixtures.familyId,
              action: 'approve',
            }),
          )
        },
      },
      {
        name: 'families bulk POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/families/bulk')
          return POST(
            orgJsonReq('/api/families/bulk', 'POST', {
              action: 'setEmailOptOut',
              ids: [ctx.fixtures.familyId],
              emailOptOut: true,
            }),
          )
        },
      },
      {
        name: 'lifecycle-event-types id GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
          return GET(
            orgJsonReq(`/api/lifecycle-event-types/${ctx.fixtures.lifecycleEventTypeId}`, 'GET'),
            { params: { id: ctx.fixtures.lifecycleEventTypeId } },
          )
        },
      },
      {
        name: 'payment-plans id GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/payment-plans/[id]')
          return GET(orgJsonReq(`/api/payment-plans/${ctx.fixtures.paymentPlanId}`, 'GET'), {
            params: { id: ctx.fixtures.paymentPlanId },
          })
        },
      },
      {
        name: 'reports saved id PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/reports/saved/[id]')
          return PUT(
            orgJsonReq(`/api/reports/saved/${ctx.fixtures.savedReportId}`, 'PUT', { name: 'Gap' }),
            { params: { id: ctx.fixtures.savedReportId } },
          )
        },
      },
      {
        name: 'reports saved GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/reports/saved')
          return GET(orgJsonReq('/api/reports/saved', 'GET'))
        },
      },
      {
        name: 'reports pl GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/reports/pl')
          return GET(orgJsonReq('/api/reports/pl', 'GET', undefined, { query: `?year=${year()}` }))
        },
      },
      {
        name: 'family-members all GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/family-members/all')
          return GET(orgJsonReq('/api/family-members/all', 'GET'))
        },
      },
      {
        name: 'families id payments GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/payments')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/payments`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families id members GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/members')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families id lifecycle-events GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/lifecycle-events`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families id withdrawals GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/withdrawals')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/withdrawals`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'members payments GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/members/[memberId]/payments')
          return GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/payments`, 'GET'), {
            params: { memberId: ctx.fixtures.memberId },
          })
        },
      },
      {
        name: 'members statements GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/members/[memberId]/statements')
          return GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'GET'), {
            params: { memberId: ctx.fixtures.memberId },
          })
        },
      },
      {
        name: 'tasks send-due-date-emails POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/tasks/send-due-date-emails')
          return POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST', {}))
        },
      },
      {
        name: 'statements generate-monthly POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/generate-monthly')
          return POST(orgJsonReq('/api/statements/generate-monthly', 'POST', {}))
        },
      },
      {
        name: 'statements send-monthly-emails POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
          return POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
        },
      },
      {
        name: 'statements send-single-email POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/send-single-email')
          return POST(
            orgJsonReq('/api/statements/send-single-email', 'POST', {
              statement: { _id: ctx.fixtures.statementId },
            }),
          )
        },
      },
      {
        name: 'tax-receipts email POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/tax-receipts/email')
          return POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
        },
      },
      {
        name: 'tax-receipts zip GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
          return GET(
            orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${year()}` }),
          )
        },
      },
      {
        name: 'trash kind id GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/trash/[kind]/[id]')
          return GET(orgJsonReq(`/api/trash/task/${ctx.fixtures.taskId}`, 'GET'), {
            params: { kind: 'task', id: ctx.fixtures.taskId },
          })
        },
      },
      {
        name: 'trash restore POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
          return POST(orgJsonReq(`/api/trash/task/${ctx.fixtures.taskId}/restore`, 'POST', {}), {
            params: { kind: 'task', id: ctx.fixtures.taskId },
          })
        },
      },
      {
        name: 'user 2fa PATCH',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/user/2fa')
          return PATCH(
            sessionJsonReq('/api/user/2fa', 'PATCH', {
              action: 'disable',
              password: 'ApiRouteTestPass123!',
              code: '000000',
            }),
          )
        },
      },
      {
        name: 'organizations automation PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/organizations/automation')
          return PUT(orgJsonReq('/api/organizations/automation', 'PUT', {}))
        },
      },
      {
        name: 'organizations branding PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/organizations/branding')
          return PUT(orgJsonReq('/api/organizations/branding', 'PUT', { primaryColor: '#aabbcc' }))
        },
      },
      {
        name: 'jobs cycle-rollover POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
          return POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        },
      },
      {
        name: 'jobs process-recurring-payments POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
          return POST(
            orgJsonReq('/api/jobs/process-recurring-payments', 'POST', {}, { cron: true }),
          )
        },
      },
      {
        name: 'jobs send-monthly-statements POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
          return POST(orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true }))
        },
      },
      {
        name: 'jobs generate-monthly-statements POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
          return POST(
            orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }),
          )
        },
      },
      {
        name: 'stripe create-payment-intent POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
          return POST(
            orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
              familyId: ctx.fixtures.familyId,
              amount: 10,
            }),
          )
        },
      },
      {
        name: 'auth invite POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/auth/invite')
          return POST(
            orgJsonReq('/api/auth/invite', 'POST', {
              email: `gap-${Date.now()}@example.com`,
              role: 'member',
            }),
          )
        },
      },
      {
        name: 'auth signup POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/auth/signup')
          return POST(
            new NextRequest(`${API_ORIGIN}/api/auth/signup`, {
              method: 'POST',
              headers: {
                host: 'localhost:3000',
                origin: API_ORIGIN,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                email: `gap-signup-${Date.now()}@example.com`,
                password: 'SignupPass123!',
                name: 'Gap User',
                inviteCode: ctx.signupCode,
              }),
            }),
          )
        },
      },
      {
        name: 'charge-saved-card POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
          return POST(
            orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
              savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
              amount: 5,
            }),
            { params: { id: ctx.fixtures.familyId } },
          )
        },
      },
      {
        name: 'convert-to-family POST',
        run: async () => {
          const { POST } =
            await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
          return POST(
            orgJsonReq(
              `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}/convert-to-family`,
              'POST',
              { weddingDate: '2024-01-01' },
            ),
            { params: { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId } },
          )
        },
      },
      {
        name: 'withdrawal id PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/families/[id]/withdrawals/[withdrawalId]')
          return PUT(
            orgJsonReq(
              `/api/families/${ctx.fixtures.familyId}/withdrawals/${ctx.fixtures.withdrawalId}`,
              'PUT',
              { amount: 10 },
            ),
            { params: { id: ctx.fixtures.familyId, withdrawalId: ctx.fixtures.withdrawalId } },
          )
        },
      },
      {
        name: 'tax-receipts pdf GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tax-receipts/[familyId]/pdf')
          return GET(
            orgJsonReq(`/api/tax-receipts/${ctx.fixtures.familyId}/pdf`, 'GET', undefined, {
              query: `?year=${year()}`,
            }),
            { params: { familyId: ctx.fixtures.familyId } },
          )
        },
      },
    ]

    it.each(cases.map((c) => [c.name, c.run] as const))(
      '%s returns 429 when rate limited',
      async (_name, run) => {
        bindSession(ctx)
        await withRateLimitBlocked(async () => {
          expect((await run()).status).toBe(429)
        })
      },
    )
  })

  describe('branch edges round 2', () => {
    it('import warns on invalid paymentPlanId and missing payment family identifier', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const warnRes = await POST(
        importReq(
          importForm(
            'families',
            `name,weddingDate,paymentPlanId\nPlanWarn,2018-01-01,${new Types.ObjectId()}`,
            'plan-id-warn.csv',
          ),
        ),
      )
      expect((await warnRes.json()).warnings?.length).toBeGreaterThan(0)

      const noFam = await POST(
        importReq(importForm('payments', 'amount,paymentDate\n10,2024-06-01', 'pay-no-fam.csv')),
      )
      expect((await noFam.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('import rejects payment for member outside family', async () => {
      bindSession(ctx)
      const { Family, FamilyMember } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const stray = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Stray',
        lastName: 'Member',
      })
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(
        importReq(
          importForm(
            'payments',
            `familyName,amount,paymentDate,memberId\n${fam?.name},10,2024-06-01,${stray._id}`,
            'pay-stray-member.csv',
          ),
        ),
      )
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
      await FamilyMember.deleteOne({ _id: stray._id })
    })

    it('stripe webhook returns 503 when secrets missing', async () => {
      const prevKey = process.env.STRIPE_SECRET_KEY
      const prevWh = process.env.STRIPE_WEBHOOK_SECRET
      delete process.env.STRIPE_SECRET_KEY
      delete process.env.STRIPE_WEBHOOK_SECRET
      vi.resetModules()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        new NextRequest('http://localhost:3000/api/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'evt_gap', type: 'ping' }),
        }),
      )
      expect(res.status).toBe(503)
      process.env.STRIPE_SECRET_KEY = prevKey ?? 'sk_test'
      process.env.STRIPE_WEBHOOK_SECRET = prevWh ?? 'whsec_test'
      vi.resetModules()
    })

    it('stripe webhook handles charge retrieve failures and duplicate payment insert', async () => {
      bindSession(ctx)
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> }
        charges: { retrieve: ReturnType<typeof vi.fn> }
      }
      const { Organization, Family, Payment } = await import('@/lib/models')
      const org = (await Organization.findById(ctx.orgId).lean()) as
        | import('@/lib/test/type-helpers').LeanDoc
        | null
      const family = (await Family.findById(ctx.fixtures.familyId).lean()) as
        | import('@/lib/test/type-helpers').LeanDoc
        | null
      const piId = `pi_gap_${Date.now()}`
      client.charges.retrieve.mockRejectedValueOnce(new Error('charge missing'))
      client.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_refund_fail_${Date.now()}`,
        type: 'charge.refunded',
        data: { object: { id: 'ch_gap', payment_intent: piId } },
      })
      let { POST } = await import('@/lib/route-logic/stripe/webhook')
      await POST(
        new NextRequest('http://localhost:3000/api/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
          body: '{}',
        }),
      )

      client.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_pi_ok_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: piId,
            amount: 5000,
            currency: 'usd',
            created: Math.floor(Date.now() / 1000),
            metadata: {
              organizationId: String(org?._id ?? ctx.orgId),
              familyId: String(family?._id ?? ctx.fixtures.familyId),
            },
          },
        },
      })
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      POST = (await import('@/lib/route-logic/stripe/webhook')).POST
      const first = await POST(
        new NextRequest('http://localhost:3000/api/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(first.status).toBe(200)
      const dupErr = Object.assign(new Error('dup'), { code: 11000 })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      client.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_pi_dup_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: piId,
            amount: 5000,
            currency: 'usd',
            created: Math.floor(Date.now() / 1000),
            metadata: {
              organizationId: String(org?._id ?? ctx.orgId),
              familyId: String(family?._id ?? ctx.fixtures.familyId),
            },
          },
        },
      })
      const second = await POST(
        new NextRequest('http://localhost:3000/api/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(second.status).toBe(200)
      createSpy.mockRestore()
    })

    it('confirm-payment handles duplicate ledger race when existing row missing', async () => {
      bindSession(ctx)
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      const piId = `pi_gap${Date.now()}`
      const { Payment } = await import('@/lib/models')
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 2500,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      const dupErr = Object.assign(new Error('dup'), { code: 11000 })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      const findSpy = vi.spyOn(Payment, 'findOne').mockResolvedValueOnce(null as never)
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const race = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piId,
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(race.status).toBe(500)
      createSpy.mockRestore()
      findSpy.mockRestore()
    })

    it('recurring process GET uses compound cursor and POST handles claim skip', async () => {
      bindSession(ctx)
      const { GET, POST } = await import('@/lib/route-logic/recurring-payments/process')
      const list = await GET(
        orgJsonReq('/api/recurring-payments/process', 'GET', undefined, {
          query: `?familyId=${ctx.fixtures.familyId}`,
        }),
      )
      expect(list.status).toBe(200)

      const { RecurringPayment } = await import('@/lib/models')
      const origUpdate = RecurringPayment.updateOne.bind(RecurringPayment)
      vi.spyOn(RecurringPayment, 'updateOne').mockImplementation(
        async (filter: any, update: any) => {
          if (filter?.nextPaymentDate) {
            return {
              acknowledged: true,
              modifiedCount: 0,
              matchedCount: 1,
              upsertedCount: 0,
              upsertedId: null,
            }
          }
          return origUpdate(filter, update)
        },
      )
      try {
        const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        expect(res.status).toBe(200)
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('families/[id] GET hits all compound cursor mappers', async () => {
      bindSession(ctx)
      const pag = await import('@/lib/pagination')
      let calls = 0
      const spy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementation(async (loadPage, baseFilter, _sf, _dir, getCursor, _bs) => {
          calls++
          const page = await loadPage(baseFilter, 2)
          if (page[0]) getCursor(page[0] as never)
          return page
        })
      try {
        const { GET } = await import('@/lib/route-logic/families/[id]')
        await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
          params: { id: ctx.fixtures.familyId },
        })
        expect(calls).toBeGreaterThanOrEqual(4)
      } finally {
        spy.mockRestore()
      }
    })

    it('member PUT fails when mongoose is disconnected', async () => {
      bindSession(ctx)
      const mongoose = await import('mongoose')
      const spy = vi.spyOn(mongoose.default.connection, 'readyState', 'get').mockReturnValue(0)
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const res = await PUT(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}`,
          'PUT',
          { firstName: 'A', lastName: 'B', birthDate: '2010-01-01', gender: 'male' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId } },
      )
      expect(res.status).toBe(500)
      spy.mockRestore()
    })

    it('tax worker returns early when atomic claim misses', async () => {
      const { EmailConfig, EmailJob } = await import('@/lib/models')
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
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'completed',
        year: year(),
        totalFamilies: 0,
        pending: [],
        completedAt: new Date(),
      })
      const spy = vi.spyOn(EmailJob, 'findOneAndUpdate').mockResolvedValueOnce(null as never)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect((await res.json()).done).toBe(true)
      spy.mockRestore()
      await EmailJob.deleteOne({ _id: job._id })
    })

    it('statement worker returns early when atomic claim misses', async () => {
      const { EmailConfig, EmailJob } = await import('@/lib/models')
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
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'running',
        fromDate: new Date(`${year()}-01-01`),
        toDate: new Date(`${year()}-12-31`),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      const spy = vi.spyOn(EmailJob, 'findOneAndUpdate').mockResolvedValueOnce(null as never)
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      spy.mockRestore()
      await EmailJob.deleteOne({ _id: job._id })
    })

    it('charge-saved-card throws when stripe key missing', async () => {
      bindSession(ctx)
      const prev = process.env.STRIPE_SECRET_KEY
      delete process.env.STRIPE_SECRET_KEY
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 5,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(500)
      process.env.STRIPE_SECRET_KEY = prev ?? 'sk_test'
    })

    it('saved-payment-methods throws when stripe key missing', async () => {
      bindSession(ctx)
      const prev = process.env.STRIPE_SECRET_KEY
      delete process.env.STRIPE_SECRET_KEY
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/saved-payment-methods`, 'POST', {
          paymentMethodId: 'pm_test123',
          paymentIntentId: 'pi_test123',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(500)
      process.env.STRIPE_SECRET_KEY = prev ?? 'sk_test'
    })

    it('create-payment-intent returns 500 when stripe is not configured', async () => {
      bindSession(ctx)
      const prev = process.env.STRIPE_SECRET_KEY
      delete process.env.STRIPE_SECRET_KEY
      vi.resetModules()
      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
      const res = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 10,
        }),
      )
      expect(res.status).toBe(500)
      process.env.STRIPE_SECRET_KEY = prev ?? 'sk_test'
      vi.resetModules()
    })
  })
})
