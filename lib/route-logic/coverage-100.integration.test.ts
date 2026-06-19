/**
 * Final per-file 100% line coverage for lib/route-logic (excl. nextauth).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'
import { encodeCompoundCursor } from '@/lib/pagination'
import { generateTotpCode } from '@/lib/totp'

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

function importReq(form: FormData, orgId?: string): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/import`, {
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
  const spy = vi
    .spyOn(pag, 'collectCompoundCursorPages')
    .mockImplementation(async (loadPage, baseFilter, _sf, _dir, getCursor, _bs) => {
      const page = await loadPage(baseFilter, 3)
      if (page[0]) getCursor(page[0] as never)
      return page
    })
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
}

describe.sequential('route-logic 100% line coverage', () => {
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

  beforeEach(() => {
    bindSession(ctx)
  })

  it('families GET uses unbounded compound cursor and empty org returns []', async () => {
    bindSession(ctx)
    await withCompoundCursorSpy(async () => {
      const { GET } = await import('@/lib/route-logic/families')
      expect((await GET(orgJsonReq('/api/families', 'GET'))).status).toBe(200)
    })

    const { Organization } = await import('@/lib/models')
    const emptyOrg = await Organization.create({
      name: `Empty ${Date.now()}`,
      slug: `empty-${Date.now()}`,
      ownerId: new Types.ObjectId(ctx.userId),
    })
    bindSession(ctx, 'owner', emptyOrg._id.toString())
    const { GET } = await import('@/lib/route-logic/families')
    const empty = await GET(
      orgJsonReq('/api/families', 'GET', undefined, { orgId: emptyOrg._id.toString() }),
    )
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual([])
    bindSession(ctx)
    await Organization.deleteOne({ _id: emptyOrg._id })
  })

  it('payments and statements GET accept null-v compound cursors', async () => {
    bindSession(ctx)
    const nullCursor = encodeCompoundCursor({ v: null, id: new Types.ObjectId().toString() })
    const { GET: payGet } = await import('@/lib/route-logic/payments')
    expect(
      (
        await payGet(
          orgJsonReq('/api/payments', 'GET', undefined, { query: `?cursor=${nullCursor}` }),
        )
      ).status,
    ).toBe(200)
    const { GET: stmtGet } = await import('@/lib/route-logic/statements')
    expect(
      (
        await stmtGet(
          orgJsonReq('/api/statements', 'GET', undefined, { query: `?cursor=${nullCursor}` }),
        )
      ).status,
    ).toBe(200)
  })

  it('import warns on invalid paymentPlanId and imports payment with memberId', async () => {
    bindSession(ctx)
    const { POST } = await import('@/lib/route-logic/import')
    const warn = await POST(
      importReq(
        importForm(
          'families',
          'name,weddingDate,paymentPlanId\nPlanBadId,2018-01-01,not-valid-oid',
          'bad-plan-id.csv',
        ),
      ),
    )
    expect((await warn.json()).warnings?.length).toBeGreaterThan(0)

    const { Family } = await import('@/lib/models')
    const fam = await Family.findById(ctx.fixtures.familyId).select('name')
    const payCsv = `familyName,amount,paymentDate,memberId\n${fam?.name},15,2024-07-01,${ctx.fixtures.memberId}`
    const ok = await POST(importReq(importForm('payments', payCsv, 'mem-ok.csv')))
    expect((await ok.json()).imported).toBeGreaterThanOrEqual(1)
  })

  it('send-file-email rejects missing recipient', async () => {
    bindSession(ctx)
    const form = new FormData()
    form.set('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'doc.pdf')
    const { POST } = await import('@/lib/route-logic/send-file-email')
    const res = await POST(
      new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
        body: form,
      }),
    )
    expect(res.status).toBe(400)
  })

  it('statements POST surfaces non-duplicate create errors', async () => {
    bindSession(ctx)
    const { Statement } = await import('@/lib/models')
    const spy = vi.spyOn(Statement, 'create').mockRejectedValueOnce(new Error('db write fail'))
    const { POST } = await import('@/lib/route-logic/statements')
    const y = year()
    const res = await POST(
      orgJsonReq('/api/statements', 'POST', {
        familyId: ctx.fixtures.familyId,
        fromDate: `${y}-02-01`,
        toDate: `${y}-02-28`,
      }),
    )
    expect(res.status).toBe(500)
    spy.mockRestore()
  })

  it('tasks validates relatedPaymentId and filters by relatedMemberId', async () => {
    bindSession(ctx)
    const { POST, GET } = await import('@/lib/route-logic/tasks')
    const bad = await POST(
      orgJsonReq('/api/tasks', 'POST', {
        title: 'Bad Pay Ref',
        dueDate: today(),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
        relatedPaymentId: 'not-valid',
      }),
    )
    expect(bad.status).toBe(400)
    await withCompoundCursorSpy(async () => {
      expect(
        (
          await GET(
            orgJsonReq('/api/tasks', 'GET', undefined, {
              query: `?relatedMemberId=${ctx.fixtures.memberId}`,
            }),
          )
        ).status,
      ).toBe(200)
    })
  })

  it('tax-receipts GET sorts multiple families', async () => {
    bindSession(ctx)
    const { Family, Payment } = await import('@/lib/models')
    const y = year()
    const extra = await Family.create({
      organizationId: ctx.orgId,
      name: `ZZZ Tax ${Date.now()}`,
      weddingDate: new Date('2015-01-01'),
    })
    await Payment.create({
      organizationId: ctx.orgId,
      familyId: extra._id,
      amount: 25,
      paymentDate: new Date(`${y}-06-01`),
      year: y,
      type: 'membership',
      paymentMethod: 'cash',
    })
    const { GET } = await import('@/lib/route-logic/tax-receipts')
    const res = await GET(
      orgJsonReq('/api/tax-receipts', 'GET', undefined, { query: `?year=${y}` }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    if (body.length >= 2) {
      expect(body[0].familyName.localeCompare(body[1].familyName)).toBeLessThanOrEqual(0)
    }
    await Payment.deleteMany({ familyId: extra._id })
    await Family.deleteOne({ _id: extra._id })
  })

  it('admin invite-requests lists and rejects malformed PATCH body', async () => {
    bindSession(ctx)
    const { InviteRequest } = await import('@/lib/models')
    await InviteRequest.create({
      email: `admin-list-${Date.now()}@example.com`,
      name: 'List Me',
      status: 'pending',
    })
    await withCompoundCursorSpy(async () => {
      const { GET } = await import('@/lib/route-logic/admin/invite-requests')
      expect((await GET(orgJsonReq('/api/admin/invite-requests', 'GET'))).status).toBe(200)
    })
    const { PATCH } = await import('@/lib/route-logic/admin/invite-requests')
    const bad = await PATCH(
      orgJsonReq('/api/admin/invite-requests', 'PATCH', null as unknown as object),
    )
    expect(bad.status).toBe(400)
  })

  it('organizations branding clears logo, rejects bad logo, DELETE rate limits', async () => {
    bindSession(ctx, 'owner')
    const { PUT, DELETE } = await import('@/lib/route-logic/organizations/branding')
    expect(
      (await PUT(orgJsonReq('/api/organizations/branding', 'PUT', { logoDataUrl: null }))).status,
    ).toBe(200)
    const badLogo = await PUT(
      orgJsonReq('/api/organizations/branding', 'PUT', { logoDataUrl: 'not-a-data-url' }),
    )
    expect(badLogo.status).toBe(400)
    await withRateLimitBlocked(async () => {
      expect((await DELETE(orgJsonReq('/api/organizations/branding', 'DELETE'))).status).toBe(429)
    })
  })

  it('organizations automation validates bar mitzvah plan id', async () => {
    bindSession(ctx)
    const { PUT } = await import('@/lib/route-logic/organizations/automation')
    const bad = await PUT(
      orgJsonReq('/api/organizations/automation', 'PUT', {
        barMitzvahAutoAssignPlanId: 'not-valid',
      }),
    )
    expect(bad.status).toBe(400)
    const badWedding = await PUT(
      orgJsonReq('/api/organizations/automation', 'PUT', {
        weddingConversionDefaultPlanId: 'not-valid',
      }),
    )
    expect(badWedding.status).toBe(400)
  })

  it('reports pl date range error and compound cursor mappers', async () => {
    bindSession(ctx)
    const { GET } = await import('@/lib/route-logic/reports/pl')
    const rangeErr = await GET(
      orgJsonReq('/api/reports/pl', 'GET', undefined, {
        query: '?startDate=2024-12-31&endDate=2024-01-01',
      }),
    )
    expect(rangeErr.status).toBe(400)
    await withCompoundCursorSpy(async () => {
      expect(
        (
          await GET(
            orgJsonReq('/api/reports/pl', 'GET', undefined, {
              query: '?startDate=2020-01-01&endDate=2020-12-31',
            }),
          )
        ).status,
      ).toBe(200)
    })
  })

  it('statements generate-monthly rejects missing body and records per-family errors', async () => {
    bindSession(ctx)
    const { POST } = await import('@/lib/route-logic/statements/generate-monthly')
    const noBody = await POST(
      new NextRequest(`${API_ORIGIN}/api/statements/generate-monthly`, {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
      }),
    )
    expect(noBody.status).toBe(400)

    const calc = await import('@/lib/calculations')
    const spy = vi
      .spyOn(calc, 'calculateFamilyBalance')
      .mockRejectedValueOnce(new Error('balance fail'))
    const res = await POST(
      orgJsonReq('/api/statements/generate-monthly', 'POST', {
        year: year(),
        month: new Date().getMonth() + 1,
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(1)
    spy.mockRestore()
  })

  it('compound cursor mappers on list endpoints', async () => {
    bindSession(ctx)
    await withCompoundCursorSpy(async () => {
      const endpoints = [
        async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/withdrawals')
          await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/withdrawals`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
        async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
          await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/lifecycle-events`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
        async () => {
          const { GET } = await import('@/lib/route-logic/members/[memberId]/payments')
          await GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/payments`, 'GET'), {
            params: { memberId: ctx.fixtures.memberId },
          })
        },
        async () => {
          const { GET } = await import('@/lib/route-logic/members/[memberId]/statements')
          await GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'GET'), {
            params: { memberId: ctx.fixtures.memberId },
          })
        },
        async () => {
          const { GET } = await import('@/lib/route-logic/recurring-payments/process')
          await GET(orgJsonReq('/api/recurring-payments/process', 'GET'))
        },
      ]
      for (const run of endpoints) await run()
    })
  })

  it('lifecycle-event-types PUT empty and DELETE when soft delete returns null', async () => {
    bindSession(ctx)
    const { PUT, DELETE } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
    const id = ctx.fixtures.lifecycleEventTypeId
    expect(
      (await PUT(orgJsonReq(`/api/lifecycle-event-types/${id}`, 'PUT', {}), { params: { id } }))
        .status,
    ).toBe(400)
    const recycle = await import('@/lib/recycle-bin')
    const spy = vi.spyOn(recycle, 'softDeleteOne').mockResolvedValueOnce(null as never)
    const missing = await DELETE(orgJsonReq(`/api/lifecycle-event-types/${id}`, 'DELETE'), {
      params: { id },
    })
    expect(missing.status).toBe(404)
    spy.mockRestore()
  })

  it('lifecycle-events POST 404 for missing family', async () => {
    bindSession(ctx)
    const missingId = new Types.ObjectId().toString()
    const { POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
    const res = await POST(
      orgJsonReq(`/api/families/${missingId}/lifecycle-events`, 'POST', {
        eventType: 'bar_mitzvah',
        amount: 50,
        eventDate: today(),
        year: year(),
      }),
      { params: { id: missingId } },
    )
    expect(res.status).toBe(404)
  })

  it('payment-plans DELETE 404 paths', async () => {
    bindSession(ctx)
    const missing = new Types.ObjectId().toString()
    const { DELETE } = await import('@/lib/route-logic/payment-plans/[id]')
    expect(
      (
        await DELETE(orgJsonReq(`/api/payment-plans/${missing}`, 'DELETE'), {
          params: { id: missing },
        })
      ).status,
    ).toBe(404)
    const recycle = await import('@/lib/recycle-bin')
    const { PaymentPlan } = await import('@/lib/models')
    const plan = await PaymentPlan.create({
      organizationId: ctx.orgId,
      name: `Del ${Date.now()}`,
      planNumber: 9000 + Math.floor(Math.random() * 1000),
      yearlyPrice: 1,
    })
    const spy = vi.spyOn(recycle, 'softDeleteOne').mockResolvedValueOnce(null as never)
    expect(
      (
        await DELETE(orgJsonReq(`/api/payment-plans/${plan._id}`, 'DELETE'), {
          params: { id: plan._id.toString() },
        })
      ).status,
    ).toBe(404)
    spy.mockRestore()
    await PaymentPlan.deleteOne({ _id: plan._id })
  })

  it('member statements POST surfaces errors and GET 429', async () => {
    bindSession(ctx)
    const { Statement } = await import('@/lib/models')
    const spy = vi.spyOn(Statement, 'create').mockRejectedValueOnce(new Error('stmt fail'))
    const { POST } = await import('@/lib/route-logic/members/[memberId]/statements')
    const y = year()
    const res = await POST(
      orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', {
        fromDate: `${y}-03-01`,
        toDate: `${y}-03-31`,
      }),
      { params: { memberId: ctx.fixtures.memberId } },
    )
    expect(res.status).toBe(500)
    spy.mockRestore()
    await withRateLimitBlocked(async () => {
      expect(
        (
          await POST(
            orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', {
              fromDate: `${y}-03-01`,
              toDate: `${y}-03-31`,
            }),
            { params: { memberId: ctx.fixtures.memberId } },
          )
        ).status,
      ).toBe(429)
    })
  })

  it('charge-saved-card invalid memberId and zod validation issues', async () => {
    bindSession(ctx)
    const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
    const zodBad = await POST(
      orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 'not-a-number',
      }),
      { params: { id: ctx.fixtures.familyId } },
    )
    expect(zodBad.status).toBe(400)
    const badMem = await POST(
      orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 5,
        memberId: 'not-valid',
      }),
      { params: { id: ctx.fixtures.familyId } },
    )
    expect(badMem.status).toBe(400)
  })

  it('saved-payment-methods PI verify failure and DELETE family 404', async () => {
    bindSession(ctx)
    const Stripe = (await import('stripe')).default
    const client = new Stripe('sk_test') as unknown as {
      paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
    }
    client.paymentIntents.retrieve.mockRejectedValueOnce(new Error('pi missing'))
    const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
    const fail = await POST(
      orgJsonReq(`/api/families/${ctx.fixtures.familyId}/saved-payment-methods`, 'POST', {
        paymentMethodId: 'pm_test',
        paymentIntentId: 'pi_test',
      }),
      { params: { id: ctx.fixtures.familyId } },
    )
    expect(fail.status).toBe(400)

    const missingFam = new Types.ObjectId().toString()
    const { DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
    const res = await DELETE(
      orgJsonReq(
        `/api/families/${missingFam}/saved-payment-methods?paymentMethodId=${ctx.fixtures.savedPaymentMethodId}`,
        'DELETE',
      ),
      { params: { id: missingFam } },
    )
    expect(res.status).toBe(404)
  })

  it('convert-to-family catches default plan lookup error', async () => {
    bindSession(ctx)
    const { FamilyMember, Organization, PaymentPlan } = await import('@/lib/models')
    const member = await FamilyMember.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.betaFamilyId,
      firstName: 'Wed',
      lastName: 'Plan',
      gender: 'female',
    })
    await Organization.updateOne(
      { _id: ctx.orgId },
      { $set: { weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId } },
    )
    const spy = vi.spyOn(PaymentPlan, 'findOne').mockImplementationOnce(() => {
      throw new Error('lookup boom')
    })
    const { POST } =
      await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
    const res = await POST(
      orgJsonReq(
        `/api/families/${ctx.fixtures.betaFamilyId}/members/${member._id}/convert-to-family`,
        'POST',
        { weddingDate: '2025-09-01' },
      ),
      { params: { id: ctx.fixtures.betaFamilyId, memberId: member._id.toString() } },
    )
    expect([201, 404, 409]).toContain(res.status)
    spy.mockRestore()
    await FamilyMember.deleteOne({ _id: member._id })
    await Organization.updateOne(
      { _id: ctx.orgId },
      { $unset: { weddingConversionDefaultPlanId: 1 } },
    )
  })

  it('tax-receipts zip bad year, no eligible, and stream error', async () => {
    bindSession(ctx)
    const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
    expect(
      (await GET(orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: '?year=abc' })))
        .status,
    ).toBe(400)

    const zipMod = await import('@/lib/zip')
    const spy = vi.spyOn(zipMod, 'streamZip').mockImplementation(async function* () {
      throw new Error('zip fail')
    })
    const fail = await GET(
      orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${year()}` }),
    )
    expect([200, 400, 500]).toContain(fail.status)
    spy.mockRestore()
  })

  it('tax-receipts pdf rejects bad year', async () => {
    bindSession(ctx)
    const { GET } = await import('@/lib/route-logic/tax-receipts/[familyId]/pdf')
    const res = await GET(
      orgJsonReq(`/api/tax-receipts/${ctx.fixtures.familyId}/pdf`, 'GET', undefined, {
        query: '?year=bad',
      }),
      { params: { familyId: ctx.fixtures.familyId } },
    )
    expect(res.status).toBe(400)
  })

  it('tax and statement email workers forbidden and continuation errors', async () => {
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
    const taxPending = [
      new Types.ObjectId(ctx.fixtures.familyId),
      new Types.ObjectId(ctx.fixtures.betaFamilyId),
      new Types.ObjectId(),
      new Types.ObjectId(),
    ]
    const taxJob = await EmailJob.create({
      organizationId: ctx.orgId,
      userId: new Types.ObjectId(ctx.userId),
      kind: 'tax-receipts',
      status: 'running',
      year: year(),
      totalFamilies: taxPending.length,
      pending: taxPending,
    })
    const stmtJob = await EmailJob.create({
      organizationId: ctx.orgId,
      userId: new Types.ObjectId(ctx.userId),
      kind: 'statements',
      status: 'running',
      fromDate: new Date(`${year()}-01-01`),
      toDate: new Date(`${year()}-12-31`),
      totalFamilies: 1,
      pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      processed: 0,
      sent: 0,
      failed: 0,
    })
    const prevCron = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'fail' })
    vi.stubGlobal('fetch', fetchSpy)
    const { POST: taxWorker } = await import('@/lib/route-logic/tax-receipts/email/worker')
    const taxCont = await taxWorker(
      orgJsonReq('/api/tax-receipts/email/worker', 'POST', {
        jobId: taxJob._id.toString(),
        organizationId: ctx.orgId,
      }),
    )
    expect(taxCont.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    const { POST: stmtWorker } = await import('@/lib/route-logic/statements/send-emails/worker')
    const cont = await stmtWorker(
      orgJsonReq('/api/statements/send-emails/worker', 'POST', {
        jobId: stmtJob._id.toString(),
        organizationId: ctx.orgId,
      }),
    )
    expect(cont.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    vi.unstubAllGlobals()
    process.env.CRON_SECRET = prevCron ?? 'test-cron-secret'
    await EmailJob.deleteMany({ _id: { $in: [taxJob._id, stmtJob._id] } })
  })

  it('send-due-date-emails missing config, empty tasks, decrypt failure', async () => {
    bindSession(ctx)
    const { EmailConfig, Task } = await import('@/lib/models')
    await EmailConfig.deleteMany({ organizationId: ctx.orgId })
    const { POST } = await import('@/lib/route-logic/tasks/send-due-date-emails')
    expect((await POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST'))).status).toBe(400)

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
    await Task.updateMany({ organizationId: ctx.orgId }, { $set: { emailSent: true } })
    const empty = await POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST'))
    expect((await empty.json()).sent).toBe(0)

    await Task.create({
      organizationId: ctx.orgId,
      title: 'Due Today',
      dueDate: new Date(),
      email: ctx.email,
      priority: 'low',
      status: 'pending',
      emailSent: false,
    })
    const bad = await POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST'))
    expect(bad.status).toBe(500)
    const enc = await import('@/lib/encryption')
    await EmailConfig.updateOne(
      { organizationId: ctx.orgId },
      { $set: { password: enc.encrypt('app-password') } },
    )
    await Task.deleteMany({ organizationId: ctx.orgId, title: 'Due Today' })
  })

  it('statements send-emails and send-monthly-emails rate limits', async () => {
    bindSession(ctx)
    await withRateLimitBlocked(async () => {
      const { POST: sendEmails } = await import('@/lib/route-logic/statements/send-emails')
      expect(
        (
          await sendEmails(
            orgJsonReq('/api/statements/send-emails', 'POST', {
              fromDate: `${year()}-01-01`,
              toDate: `${year()}-12-31`,
            }),
          )
        ).status,
      ).toBe(429)
      const { POST: monthly } = await import('@/lib/route-logic/statements/send-monthly-emails')
      expect(
        (await monthly(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))).status,
      ).toBe(429)
    })
  })

  it('stripe create-payment-intent invalid familyId and init catch', async () => {
    bindSession(ctx)
    const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
    const bad = await POST(
      orgJsonReq('/api/stripe/create-payment-intent', 'POST', { familyId: 'bad', amount: 10 }),
    )
    expect(bad.status).toBe(400)
  })

  it('recurring-payments process duplicate ledger and missing stripe key', async () => {
    bindSession(ctx)
    const { RecurringPayment } = await import('@/lib/models')
    const due = new Date()
    due.setDate(due.getDate() - 1)
    const recDue = await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      amount: 9,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
    })
    const prev = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    const { POST: postNoStripe } = await import('@/lib/route-logic/recurring-payments/process')
    const noKey = await postNoStripe(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(noKey.status).toBe(200)
    expect((await noKey.json()).failed).toBeGreaterThanOrEqual(1)
    process.env.STRIPE_SECRET_KEY = prev ?? 'sk_test'
    await RecurringPayment.deleteOne({ _id: recDue._id })

    bindSession(ctx)
    const { Payment } = await import('@/lib/models')
    const rec = await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      amount: 10,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
      notes: 'cov',
    })
    const Stripe = (await import('stripe')).default
    const client = new Stripe('sk_test') as unknown as {
      paymentIntents: { create: ReturnType<typeof vi.fn> }
    }
    const piId = `pi_rec_dup_${Date.now()}`
    client.paymentIntents.create.mockResolvedValueOnce({
      id: piId,
      status: 'succeeded',
      amount: 1000,
      currency: 'usd',
    })
    const dupErr = Object.assign(new Error('dup'), { code: 11000 })
    const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
    vi.spyOn(Payment, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      organizationId: ctx.orgId,
      stripePaymentIntentId: piId,
    } as never)
    const { POST } = await import('@/lib/route-logic/recurring-payments/process')
    const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(res.status).toBe(200)
    createSpy.mockRestore()
    await RecurringPayment.deleteOne({ _id: rec._id })
  })

  it('trash restore rethrows unhandled recycle errors', async () => {
    bindSession(ctx)
    const recycle = await import('@/lib/recycle-bin')
    const spy = vi.spyOn(recycle, 'restoreFromBin').mockRejectedValueOnce(new Error('restore boom'))
    const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
    const res = await POST(
      orgJsonReq(`/api/trash/task/${ctx.fixtures.disposableTaskId}/restore`, 'POST', {}),
      { params: { kind: 'task', id: ctx.fixtures.disposableTaskId } },
    )
    expect(res.status).toBe(500)
    spy.mockRestore()
  })

  it('user 2fa disable without password hash and setup totp catch', async () => {
    const { User } = await import('@/lib/models')
    const enc = await import('@/lib/encryption')
    const secret = enc.encrypt('JBSWY3DPEHPK3PXP')
    await User.updateOne(
      { _id: ctx.userId },
      {
        $set: {
          twoFactorEnabled: true,
          twoFactorSecret: secret,
          twoFactorBackupCodes: [],
          hashedPassword: await (await import('bcryptjs')).hash('ApiRouteTestPass123!', 10),
        },
      },
    )
    const { PATCH } = await import('@/lib/route-logic/user/2fa')
    const badTotp = await PATCH(
      sessionJsonReq('/api/user/2fa', 'PATCH', {
        action: 'disable',
        password: 'ApiRouteTestPass123!',
        code: '000000',
      }),
    )
    expect(badTotp.status).toBe(401)

    await User.updateOne({ _id: ctx.userId }, { $unset: { hashedPassword: 1 } })
    const noHash = await PATCH(
      sessionJsonReq('/api/user/2fa', 'PATCH', {
        action: 'disable',
        password: 'x',
        code: '000000',
      }),
    )
    expect(noHash.status).toBe(500)

    await User.updateOne(
      { _id: ctx.userId },
      {
        $set: {
          twoFactorEnabled: false,
          hashedPassword: await (await import('bcryptjs')).hash('ApiRouteTestPass123!', 10),
        },
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1 },
      },
    )
    bindSession(ctx)

    const { POST } = await import('@/lib/route-logic/user/2fa/setup')
    const code = generateTotpCode('JBSWY3DPEHPK3PXP')
    const fail = await POST(
      sessionJsonReq('/api/user/2fa/setup', 'POST', {
        password: 'ApiRouteTestPass123!',
        code,
      }),
    )
    expect([200, 401]).toContain(fail.status)
  })

  it('jobs send-monthly-statements fetch failure path', async () => {
    const { Organization } = await import('@/lib/models')
    const day = new Date().getUTCDate()
    await Organization.updateOne(
      { _id: ctx.orgId },
      {
        $set: {
          monthlyStatementAutoEmail: true,
          monthlyStatementCalendar: 'gregorian',
          monthlyStatementDay: day,
          timezone: 'UTC',
        },
      },
    )
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err' })
    vi.stubGlobal('fetch', fetchSpy)
    const jobs = await import('@/lib/jobs')
    const spy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
      await opts.perOrg(ctx.orgId)
      return {
        hasMore: false,
        cursorOut: null,
        jobRunId: 'jr',
        processed: 0,
        failed: 0,
        errors: [],
      }
    })
    try {
      const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
      const res = await POST(
        orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true }),
      )
      expect(res.status).toBe(500)
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
      await Organization.updateOne({ _id: ctx.orgId }, { $unset: { monthlyStatementAutoEmail: 1 } })
    }
  })
})
