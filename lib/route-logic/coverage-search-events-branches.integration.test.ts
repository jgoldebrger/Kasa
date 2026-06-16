/**
 * Branch/function coverage for search, events, dashboard-stats, cycle-config,
 * and families/balances + families/bulk route-logic domains.
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
  opts?: { query?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': ctx.orgId,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const q = opts?.query ?? ''
  return new NextRequest(`${API_ORIGIN}${path}${q}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

describe.sequential('route-logic search/events branch coverage', () => {
  const year = () => new Date().getFullYear()

  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
    process.env.PLATFORM_ADMIN_EMAILS = ''
    ctx = await seedApiRouteFixtures()
    process.env.PLATFORM_ADMIN_EMAILS = ctx.email
        bindSession(ctx, 'admin')
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('search', () => {
    it('returns 429 when rate limited', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/search')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=test' }))).status).toBe(
          429,
        )
      })
    })

    it('labels payments without familyId and builds note-only sublabels', async () => {
      bindSession(ctx, 'admin')
      const { Payment } = await import('@/lib/models')
      const token = `NOPFAM${Date.now()}`
      const paymentId = new Types.ObjectId()
      await Payment.collection.insertOne({
        _id: paymentId,
        organizationId: new Types.ObjectId(ctx.orgId),
        amount: 77,
        paymentDate: new Date('2024-06-15'),
        year: year(),
        notes: `orphan note ${token}`,
        deletedAt: null,
      })
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${token}` }))
      const body = await res.json()
      const hit = body.items.find((i: { type: string }) => i.type === 'payment')
      expect(hit?.label).toContain('payment')
      expect(hit?.href).toBe('/payments')
      expect(hit?.sublabel).toContain(token)
      expect(hit?.sublabel).not.toContain('Check #')
      expect(hit?.sublabel).not.toContain('••')
      await Payment.deleteOne({ _id: paymentId })
    })

    it('prefers check ref over card ref in payment sublabel', async () => {
      bindSession(ctx, 'admin')
      const { Payment } = await import('@/lib/models')
      const token = `CHKCRD${Date.now()}`
      const payment = await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 11,
        paymentDate: new Date(),
        year: year(),
        notes: token,
        checkInfo: { checkNumber: token, bankName: 'Both Bank' },
        ccInfo: { last4: '9999' },
      })
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${token}` }))
      const hit = (await res.json()).items.find((i: { type: string }) => i.type === 'payment')
      expect(hit?.sublabel).toContain(`Check #${token}`)
      expect(hit?.sublabel).not.toContain('••9999')
      await Payment.deleteOne({ _id: payment._id })
    })

    it('uses Family member sublabel when member has no familyId', async () => {
      bindSession(ctx)
      const { FamilyMember } = await import('@/lib/models')
      const stamp = `NOFAM${Date.now()}`
      const memberId = new Types.ObjectId()
      await FamilyMember.collection.insertOne({
        _id: memberId,
        organizationId: new Types.ObjectId(ctx.orgId),
        firstName: stamp,
        lastName: 'Orphan',
        deletedAt: null,
      })
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${stamp}` }))
      const hit = (await res.json()).items.find((i: { type: string }) => i.type === 'member')
      expect(hit?.sublabel).toBe('Family member')
      expect(hit?.href).toBe('/families')
      await FamilyMember.deleteOne({ _id: memberId })
    })

    it('uses hebrew member names when english names are blank', async () => {
      bindSession(ctx)
      const { Family, FamilyMember } = await import('@/lib/models')
      const stamp = `HBONLY${Date.now()}`
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `${stamp} Fam`,
        weddingDate: new Date('2012-06-01'),
      })
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: fam._id,
        firstName: 'Placeholder',
        lastName: 'Member',
        hebrewFirstName: 'דוד',
        hebrewLastName: stamp,
      })
      await FamilyMember.updateOne(
        { _id: member._id },
        { $set: { firstName: '', lastName: '' } },
      )
      const { GET } = await import('@/lib/route-logic/search')
      const hit = (await (await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${stamp}` }))).json())
        .items.find((i: { type: string }) => i.type === 'member')
      expect(hit?.label).toContain(stamp)
      await FamilyMember.deleteOne({ _id: member._id })
      await Family.deleteOne({ _id: fam._id })
    })

    it('omits date from payment sublabel when paymentDate is missing', async () => {
      bindSession(ctx, 'admin')
      const { Payment } = await import('@/lib/models')
      const token = `NODATE${Date.now()}`
      const paymentId = new Types.ObjectId()
      await Payment.collection.insertOne({
        _id: paymentId,
        organizationId: new Types.ObjectId(ctx.orgId),
        familyId: new Types.ObjectId(ctx.fixtures.familyId),
        amount: 15,
        year: year(),
        notes: token,
        ccInfo: { last4: '1234' },
        deletedAt: null,
      })
      const { GET } = await import('@/lib/route-logic/search')
      const hit = (await (await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${token}` }))).json())
        .items.find((i: { type: string }) => i.type === 'payment')
      expect(hit?.sublabel).toContain('••1234')
      expect(hit?.sublabel).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
      await Payment.deleteOne({ _id: paymentId })
    })

    it('uses empty family sublabel when only english name exists', async () => {
      bindSession(ctx)
      const { Family } = await import('@/lib/models')
      const stamp = `NONHB${Date.now()}`
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `${stamp} Only`,
        weddingDate: new Date('2013-01-01'),
      })
      const { GET } = await import('@/lib/route-logic/search')
      const hit = (await (await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${stamp}` }))).json())
        .items.find((i: { type: string }) => i.type === 'family')
      expect(hit?.sublabel).toBe('')
      await Family.deleteOne({ _id: fam._id })
    })

    it('filters payments whose familyId is not in the org', async () => {
      bindSession(ctx, 'admin')
      const { Payment } = await import('@/lib/models')
      const token = `GHOST${Date.now()}`
      const ghost = await Payment.create({
        organizationId: ctx.orgId,
        familyId: new Types.ObjectId(),
        amount: 3,
        paymentDate: new Date(),
        year: year(),
        notes: token,
      })
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${token}` }))
      const body = await res.json()
      expect(body.items.every((i: { type: string }) => i.type !== 'payment')).toBe(true)
      await Payment.deleteOne({ _id: ghost._id })
    })
  })

  describe('events', () => {
    it('returns 429 when rate limited', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/events')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/events', 'GET'))).status).toBe(429)
      })
    })

    it('uses configured type labels and handles null eventDate cursors', async () => {
      bindSession(ctx, 'admin')
      const { LifecycleEvent, LifecycleEventPayment } = await import('@/lib/models')
      const y = year()
      const typeKey = `cfg_type_${Date.now()}`
      await LifecycleEvent.create({
        organizationId: ctx.orgId,
        type: typeKey,
        name: 'Configured Label',
        amount: 50,
      })
      const payment = await LifecycleEventPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        eventType: typeKey,
        eventDate: new Date(`${y}-05-01`),
        year: y,
        amount: 50,
      })

      const { GET } = await import('@/lib/route-logic/events')
      const res = await GET(orgJsonReq('/api/events', 'GET'))
      const row = (await res.json()).find((r: { eventType: string }) => r.eventType === typeKey)
      expect(row?.eventTypeLabel).toBe('Configured Label')

      const pag = await import('@/lib/pagination')
      const nullDateSpy = vi.spyOn(pag, 'collectCompoundCursorPages').mockImplementationOnce(
        async () => [
          {
            _id: new Types.ObjectId(),
            familyId: ctx.fixtures.familyId,
            eventType: typeKey,
            eventDate: null,
            year: y,
            amount: 1,
          },
        ],
      )
      const res2 = await GET(orgJsonReq('/api/events', 'GET'))
      nullDateSpy.mockRestore()
      const nullRow = (await res2.json()).find(
        (r: { eventDate: unknown }) => r.eventDate === null,
      )
      expect(nullRow?.eventTypeLabel).toBe('Configured Label')

      await LifecycleEventPayment.deleteOne({ _id: payment._id })
      await LifecycleEvent.deleteMany({ organizationId: ctx.orgId, type: typeKey })
    })

    it('invokes compound cursor mapper when paginating event payments', async () => {
      bindSession(ctx, 'admin')
      const { LifecycleEventPayment } = await import('@/lib/models')
      const y = year()
      const ids: Types.ObjectId[] = []
      for (let i = 0; i < 3; i++) {
        const doc = await LifecycleEventPayment.create({
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          eventType: 'bar_mitzvah',
          eventDate: new Date(`${y}-01-${String(i + 1).padStart(2, '0')}`),
          year: y,
          amount: 10 + i,
        })
        ids.push(doc._id as Types.ObjectId)
      }
      const pag = await import('@/lib/pagination')
      const realCollect = pag.collectCompoundCursorPages
      const spy = vi.spyOn(pag, 'collectCompoundCursorPages').mockImplementation(
        (loadPage, baseFilter, sortField, direction, getCursor) =>
          realCollect(loadPage, baseFilter, sortField, direction, getCursor, 1),
      )
      const { GET } = await import('@/lib/route-logic/events')
      const res = await GET(orgJsonReq('/api/events', 'GET'))
      spy.mockRestore()
      expect(res.status).toBe(200)
      expect((await res.json()).length).toBeGreaterThanOrEqual(3)
      await LifecycleEventPayment.deleteMany({ _id: { $in: ids } })
    })

    it('includes notes on formatted lifecycle event rows', async () => {
      bindSession(ctx, 'admin')
      const { LifecycleEventPayment } = await import('@/lib/models')
      const y = year()
      const note = `evt note ${Date.now()}`
      const payment = await LifecycleEventPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        eventType: 'bar_mitzvah',
        eventDate: new Date(`${y}-07-04`),
        year: y,
        amount: 30,
        notes: note,
      })
      const { GET } = await import('@/lib/route-logic/events')
      const row = (await (await GET(orgJsonReq('/api/events', 'GET'))).json()).find(
        (r: { notes: string }) => r.notes === note,
      )
      expect(row?.notes).toBe(note)
      await LifecycleEventPayment.deleteOne({ _id: payment._id })
    })

    it('falls back to raw type when configured name is empty', async () => {
      bindSession(ctx, 'admin')
      const { LifecycleEvent } = await import('@/lib/models')
      const typeKey = `empty_name_${Date.now()}`
      const ev = await LifecycleEvent.create({
        organizationId: ctx.orgId,
        type: typeKey,
        name: 'Placeholder',
        amount: 10,
      })
      await LifecycleEvent.collection.updateOne({ _id: ev._id }, { $set: { name: '' } })
      const { GET } = await import('@/lib/route-logic/events')
      const pag = await import('@/lib/pagination')
      const spy = vi.spyOn(pag, 'collectCompoundCursorPages').mockImplementationOnce(async () => [
        {
          _id: new Types.ObjectId(),
          familyId: ctx.fixtures.familyId,
          eventType: typeKey,
          eventDate: new Date(),
          year: year(),
          amount: 5,
        },
      ])
      const row = (await (await GET(orgJsonReq('/api/events', 'GET'))).json()).find(
        (r: { eventType: string }) => r.eventType === typeKey,
      )
      spy.mockRestore()
      expect(row?.eventTypeLabel).toBe(typeKey)
      await LifecycleEvent.deleteMany({ organizationId: ctx.orgId, type: typeKey })
    })
  })

  describe('dashboard-stats', () => {
    it('rejects invalid year query param', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/dashboard-stats')
      const res = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: '?year=not-a-year' }),
      )
      expect(res.status).toBe(400)
    })

    it('computes totals on the fly when no YearlyCalculation exists and compute=1', async () => {
      bindSession(ctx, 'admin')
      const y = year() + 88
      const { YearlyCalculation } = await import('@/lib/models')
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })
      const { GET } = await import('@/lib/route-logic/dashboard-stats')
      const res = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}&compute=1` }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.year).toBe(y)
      expect(typeof body.calculatedIncome).toBe('number')
      expect(body.financialsPending).toBe(false)
    })

    it('returns financialsPending without compute when no YearlyCalculation exists', async () => {
      bindSession(ctx, 'admin')
      const y = year() + 87
      const { YearlyCalculation } = await import('@/lib/models')
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })
      const { GET } = await import('@/lib/route-logic/dashboard-stats')
      const res = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}` }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.financialsPending).toBe(true)
      expect(body.balance).toBe(0)
      expect(body.calculatedIncome).toBe(0)
    })

    it('returns partial payload when live calculation throws', async () => {
      bindSession(ctx, 'admin')
      const y = year() + 99
      const { YearlyCalculation } = await import('@/lib/models')
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })
      const calcMod = await import('@/lib/calculations')
      const spy = vi
        .spyOn(calcMod, 'calculateYearlyBalance')
        .mockRejectedValueOnce(new Error('dash calc fail'))
      try {
        const { GET } = await import('@/lib/route-logic/dashboard-stats')
        const res = await GET(
          orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}&compute=1` }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.totalFamilies).toBeGreaterThanOrEqual(0)
        expect(body.calculatedIncome).toBe(0)
        expect(body.balance).toBe(0)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/balances', () => {
    it('returns 429 when rate limited', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/families/balances')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/families/balances', 'GET'))).status).toBe(429)
      })
    })

    it('nets refunded amounts and applies payment plan yearlyPrice', async () => {
      bindSession(ctx, 'admin')
      const { Family, Payment } = await import('@/lib/models')
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `Plan Fam ${Date.now()}`,
        weddingDate: new Date('2014-01-01'),
        paymentPlanId: ctx.fixtures.paymentPlanId,
      })
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: fam._id,
        amount: 100,
        refundedAmount: 25,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'check',
      })
      const { GET } = await import('@/lib/route-logic/families/balances')
      const row = (await (await GET(orgJsonReq('/api/families/balances', 'GET'))).json()).find(
        (r: { familyId: string }) => r.familyId === fam._id.toString(),
      )
      expect(row?.totalPayments).toBeGreaterThanOrEqual(75)
      expect(row?.planCost).toBeGreaterThan(0)
      await Family.deleteOne({ _id: fam._id })
    })

    it('returns zero planCost for families without a payment plan', async () => {
      bindSession(ctx, 'admin')
      const { Family } = await import('@/lib/models')
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `No Plan ${Date.now()}`,
        weddingDate: new Date('2015-01-01'),
        paymentPlanId: null,
      })
      const { GET } = await import('@/lib/route-logic/families/balances')
      const row = (await (await GET(orgJsonReq('/api/families/balances', 'GET'))).json()).find(
        (r: { familyId: string }) => r.familyId === fam._id.toString(),
      )
      expect(row?.planCost).toBe(0)
      await Family.deleteOne({ _id: fam._id })
    })
  })

  describe('families/bulk', () => {
    it('returns 429 when rate limited', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/bulk')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq('/api/families/bulk', 'POST', {
                action: 'setEmailOptOut',
                ids: [ctx.fixtures.familyId],
                emailOptOut: false,
              }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('clears payment plan when paymentPlanId is null', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setPaymentPlan',
          ids: [ctx.fixtures.familyId],
          paymentPlanId: null,
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).modified).toBeGreaterThanOrEqual(1)
    })

    it('setEmailOptOut updates families in bulk', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setEmailOptOut',
          ids: [ctx.fixtures.familyId],
          emailOptOut: true,
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).modified).toBeGreaterThanOrEqual(1)
    })

    it('setPaymentPlan returns 404 for foreign plan id', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setPaymentPlan',
          ids: [ctx.fixtures.familyId],
          paymentPlanId: new Types.ObjectId().toString(),
        }),
      )
      expect(res.status).toBe(404)
    })

    it('skips modified count when cascade returns null', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const recycle = await import('@/lib/recycle-bin')
      const spy = vi.spyOn(recycle, 'softDeleteFamilyCascade').mockResolvedValueOnce(null)
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'delete',
          ids: [new Types.ObjectId().toString()],
        }),
      )
      spy.mockRestore()
      expect(res.status).toBe(200)
      expect((await res.json()).modified).toBe(0)
    })

    it('delete records failed ids when cascade throws', async () => {
      bindSession(ctx, 'admin')
      const { Family } = await import('@/lib/models')
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `Bulk Fail ${Date.now()}`,
        weddingDate: new Date('2018-01-01'),
      })
      const recycle = await import('@/lib/recycle-bin')
      const spy = vi.spyOn(recycle, 'softDeleteFamilyCascade').mockRejectedValueOnce(new Error('cascade fail'))
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'delete',
          ids: [fam._id.toString()],
        }),
      )
      spy.mockRestore()
      expect(res.status).toBe(200)
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
      await Family.deleteOne({ _id: fam._id })
    })

    it('soft-deletes families via cascade on delete action', async () => {
      bindSession(ctx, 'admin')
      const { Family } = await import('@/lib/models')
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `Bulk Del ${Date.now()}`,
        weddingDate: new Date('2016-01-01'),
      })
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'delete',
          ids: [fam._id.toString()],
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.modified).toBe(1)
      expect(body.failed).toBe(0)
      const deleted = await Family.findOne({ _id: fam._id }, null, { includeDeleted: true })
      expect(deleted?.deletedAt).toBeTruthy()
    })
  })

  describe('cycle-config', () => {
    it('returns 429 on GET and POST when rate limited', async () => {
      bindSession(ctx, 'admin')
      const { GET, POST } = await import('@/lib/route-logic/cycle-config')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/cycle-config', 'GET'))).status).toBe(429)
        expect(
          (
            await POST(
              orgJsonReq('/api/cycle-config', 'POST', {
                cycleCalendar: 'gregorian',
                cycleStartMonth: 9,
                cycleStartDay: 1,
              }),
            )
          ).status,
        ).toBe(429)
      })
    })

    it('GET normalizes hebrew calendar from stored config', async () => {
      bindSession(ctx, 'admin')
      const { CycleConfig } = await import('@/lib/models')
      await CycleConfig.deleteMany({ organizationId: ctx.orgId })
      await CycleConfig.create({
        organizationId: ctx.orgId,
        isActive: true,
        cycleCalendar: 'hebrew',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        cycleAutoRollover: false,
      })
      const { GET } = await import('@/lib/route-logic/cycle-config')
      const body = await (await GET(orgJsonReq('/api/cycle-config', 'GET'))).json()
      expect(body.cycleCalendar).toBe('hebrew')
    })

    it('GET normalizes gregorian config and hebrew field fallbacks', async () => {
      bindSession(ctx, 'admin')
      const { CycleConfig } = await import('@/lib/models')
      await CycleConfig.deleteMany({ organizationId: ctx.orgId })
      await CycleConfig.create({
        organizationId: ctx.orgId,
        isActive: true,
        cycleCalendar: 'gregorian',
        cycleStartMonth: 3,
        cycleStartDay: 15,
        cycleAutoRollover: true,
        description: 'Gregorian cfg',
      })
      const { GET } = await import('@/lib/route-logic/cycle-config')
      const body = await (await GET(orgJsonReq('/api/cycle-config', 'GET'))).json()
      expect(body.cycleCalendar).toBe('gregorian')
      expect(body.cycleStartHebrewMonth).toBe(7)
      expect(body.cycleStartHebrewDay).toBe(1)
    })

    it('POST validates body and hebrew calendar fields', async () => {
      bindSession(ctx, 'admin')
      const { CycleConfig } = await import('@/lib/models')
      await CycleConfig.deleteMany({ organizationId: ctx.orgId })
      const { GET, POST } = await import('@/lib/route-logic/cycle-config')

      expect((await POST(orgJsonReq('/api/cycle-config', 'POST', {}))).status).toBe(400)
      expect(
        (await POST(orgJsonReq('/api/cycle-config', 'POST', { cycleStartMonth: 5 }))).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/cycle-config', 'POST', {
              cycleCalendar: 'gregorian',
              cycleStartMonth: 13,
              cycleStartDay: 1,
            }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/cycle-config', 'POST', {
              cycleCalendar: 'gregorian',
              cycleStartMonth: 6,
              cycleStartDay: 32,
            }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/cycle-config', 'POST', {
              cycleCalendar: 'hebrew',
              cycleStartMonth: 9,
              cycleStartDay: 1,
            }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/cycle-config', 'POST', {
              cycleCalendar: 'gregorian',
              cycleStartMonth: 9,
              cycleStartDay: 1,
              cycleStartHebrewMonth: 14,
            }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/cycle-config', 'POST', {
              cycleCalendar: 'gregorian',
              cycleStartMonth: 9,
              cycleStartDay: 1,
              cycleStartHebrewDay: 31,
            }),
          )
        ).status,
      ).toBe(400)

      const ok = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'gregorian',
          cycleStartMonth: 9,
          cycleStartDay: 1,
        }),
      )
      expect(ok.status).toBe(201)

      const preserveAuto = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'solar',
          cycleStartMonth: 10,
          cycleStartDay: 2,
          cycleStartHebrewMonth: 8,
          cycleStartHebrewDay: 3,
        }),
      )
      expect(preserveAuto.status).toBe(200)
      const saved = await (await GET(orgJsonReq('/api/cycle-config', 'GET'))).json()
      expect(saved.cycleCalendar).toBe('gregorian')
      expect(saved.cycleStartHebrewMonth).toBe(8)
    })
  })
})
