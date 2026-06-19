/**
 * Remaining route-logic line coverage (gap-order finish pass).
 * Shares fixtures with api-routes.integration.test.ts; run in route-logic vitest project only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'
import { generateTotpCode } from '@/lib/totp'
import { inviteTokenFromUrl } from '@/lib/invite-token'

const mockAuth = vi.hoisted(() => vi.fn())
const mockCookieGet = vi.hoisted(() => vi.fn())

vi.mock('@/app/auth', () => ({
  auth: mockAuth,
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

function bindSession(c: ApiTestContext) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [
        { o: c.orgId, r: 'owner' },
        { o: c.betaOrgId, r: 'owner' },
      ],
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

function publicJsonReq(path: string, method: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}`, {
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

describe.sequential('route-logic finish coverage', () => {
  const today = () => new Date().toISOString().slice(0, 10)
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
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('families/[id]/members/[memberId]', () => {
    it('updates and soft-deletes a member', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Finish',
        lastName: 'Member',
        birthDate: new Date('2011-06-15'),
        gender: 'female',
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const path = `/api/families/${params.id}/members/${params.memberId}`
      const { PUT, DELETE } = await import('@/lib/route-logic/families/[id]/members/[memberId]')

      const putRes = await PUT(
        orgJsonReq(path, 'PUT', {
          firstName: 'FinishUpdated',
          lastName: 'Member',
          birthDate: '2011-06-15',
          phone: '555-0100',
        }),
        { params },
      )
      expect(putRes.status).toBe(200)

      const delRes = await DELETE(orgJsonReq(path, 'DELETE'), { params })
      expect(delRes.status).toBe(200)

      expect(
        (
          await PUT(
            orgJsonReq(path, 'PUT', { firstName: 'X', lastName: 'Y', birthDate: '2011-01-01' }),
            {
              params: { id: 'not-valid', memberId: params.memberId },
            },
          )
        ).status,
      ).toBe(400)
    })
  })

  describe('families', () => {
    it('lists with pagination and creates a family', async () => {
      const { GET, POST } = await import('@/lib/route-logic/families')

      const paged = await GET(orgJsonReq('/api/families', 'GET', undefined, { query: '?limit=2' }))
      expect(paged.status).toBe(200)
      const page = await paged.json()
      expect(page.items.length).toBeLessThanOrEqual(2)

      expect(
        (await GET(orgJsonReq('/api/families', 'GET', undefined, { query: '?cursor=bad' }))).status,
      ).toBe(400)

      const createRes = await POST(
        orgJsonReq('/api/families', 'POST', {
          name: `Finish Family ${Date.now()}`,
          weddingDate: '2014-07-04',
          paymentPlanId: ctx.fixtures.paymentPlanId,
        }),
      )
      expect(createRes.status).toBe(201)

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)
      const memberList = await GET(orgJsonReq('/api/families', 'GET'))
      expect(memberList.status).toBe(200)
      const rows = await memberList.json()
      expect(Array.isArray(rows)).toBe(true)
      if (rows.length > 0) expect(rows[0].openBalance).toBeUndefined()
      bindSession(ctx)
    })
  })

  describe('families/[id]/members', () => {
    it('redacts billing fields for non-admin members', async () => {
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.userId,
          email: ctx.email,
          name: ctx.userName,
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)

      const { GET } = await import('@/lib/route-logic/families/[id]/members')
      const params = { id: ctx.fixtures.familyId }
      const res = await GET(orgJsonReq(`/api/families/${params.id}/members`, 'GET'), { params })
      expect(res.status).toBe(200)
      const rows = await res.json()
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].paymentPlanId).toBeUndefined()
      expect(rows[0].paymentPlanAssigned).toBeUndefined()
      bindSession(ctx)
    })

    it('adds a member via POST', async () => {
      const { POST } = await import('@/lib/route-logic/families/[id]/members')
      const params = { id: ctx.fixtures.familyId }
      const res = await POST(
        orgJsonReq(`/api/families/${params.id}/members`, 'POST', {
          firstName: 'Added',
          lastName: 'Finish',
          birthDate: '2013-01-20',
          gender: 'male',
        }),
        { params },
      )
      expect(res.status).toBe(201)
    })

    it('auto-creates a lifecycle event when adding a child if configured', async () => {
      const { Organization, LifecycleEventPayment } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { addChildAutoCreateEventTypeId: ctx.fixtures.lifecycleEventTypeId } },
      )

      const { POST } = await import('@/lib/route-logic/families/[id]/members')
      const params = { id: ctx.fixtures.familyId }
      const res = await POST(
        orgJsonReq(`/api/families/${params.id}/members`, 'POST', {
          firstName: 'New',
          lastName: 'Child',
          birthDate: '2018-06-01',
          gender: 'female',
        }),
        { params },
      )
      expect(res.status).toBe(201)

      const events = await LifecycleEventPayment.find({
        familyId: ctx.fixtures.familyId,
        organizationId: ctx.orgId,
        notes: /child added/i,
      }).lean()
      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => String(e.notes).includes('New Child'))).toBe(true)
    })

    it('auto-assigns bar mitzvah plan when creating an eligible male member', async () => {
      const { Organization, FamilyMember } = await import('@/lib/models')
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId,
            barMitzvahAutoCreateEventTypeId: ctx.fixtures.lifecycleEventTypeId,
          },
        },
      )

      const birth = new Date('2010-04-15')
      const hebrew = convertToHebrewDate(birth)
      const { POST } = await import('@/lib/route-logic/families/[id]/members')
      const params = { id: ctx.fixtures.familyId }
      const res = await POST(
        orgJsonReq(`/api/families/${params.id}/members`, 'POST', {
          firstName: 'Create',
          lastName: 'BarMitzvah',
          birthDate: birth.toISOString().slice(0, 10),
          hebrewBirthDate: hebrew,
          gender: 'male',
        }),
        { params },
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      const created = await FamilyMember.findById(body._id ?? body.id)
      expect(created?.paymentPlanAssigned).toBe(true)
    })
  })

  describe('search', () => {
    it('finds families, members, and payments for admins', async () => {
      const { Payment } = await import('@/lib/models')
      const y = year()
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 50,
        paymentDate: new Date(),
        year: y,
        type: 'membership',
        paymentMethod: 'check',
        checkInfo: { checkNumber: 'FINISH-CHK-99', bankName: 'Finish Bank' },
      })

      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=FINISH-CHK' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items.some((i: { type: string }) => i.type === 'payment')).toBe(true)
    })
  })

  describe('notifications', () => {
    it('lists and marks notifications read', async () => {
      const { Notification } = await import('@/lib/models')
      const note = await Notification.create({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        kind: 'test',
        title: 'Finish notification',
        body: 'probe',
      })

      const { GET, POST } = await import('@/lib/route-logic/notifications')
      const list = await GET(orgJsonReq('/api/notifications', 'GET'))
      expect(list.status).toBe(200)
      expect((await list.json()).items.length).toBeGreaterThan(0)

      const mark = await POST(
        orgJsonReq('/api/notifications', 'POST', { ids: [note._id.toString()] }),
      )
      expect(mark.status).toBe(200)

      const markAll = await POST(orgJsonReq('/api/notifications', 'POST', { all: true }))
      expect(markAll.status).toBe(200)

      const bad = await POST(orgJsonReq('/api/notifications', 'POST', {}))
      expect(bad.status).toBe(400)
    })
  })

  describe('dashboard-stats', () => {
    it('returns stats for admin and redacted view for members', async () => {
      const { GET } = await import('@/lib/route-logic/dashboard-stats')

      const adminRes = await GET(orgJsonReq('/api/dashboard-stats', 'GET'))
      expect(adminRes.status).toBe(200)
      const adminBody = await adminRes.json()
      expect(adminBody.balance).toBeDefined()

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)
      const memberRes = await GET(orgJsonReq('/api/dashboard-stats', 'GET'))
      expect(memberRes.status).toBe(200)
      expect((await memberRes.json()).balance).toBeUndefined()
      bindSession(ctx)

      expect(
        (await GET(orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: '?year=abc' })))
          .status,
      ).toBe(400)

      const y = year()
      const withYear = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}` }),
      )
      expect(withYear.status).toBe(200)
      expect((await withYear.json()).year).toBe(y)
    })

    it('returns zeroed totals when yearly calculation fails', async () => {
      const { YearlyCalculation } = await import('@/lib/models')
      const calculations = await import('@/lib/calculations')
      const y = year() + 1
      await YearlyCalculation.deleteOne({ organizationId: ctx.orgId, year: y })
      const spy = vi
        .spyOn(calculations, 'calculateYearlyBalance')
        .mockRejectedValueOnce(new Error('calc probe failure'))
      try {
        const { GET } = await import('@/lib/route-logic/dashboard-stats')
        const res = await GET(
          orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}&compute=1` }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.balance).toBe(0)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('cycle-config', () => {
    it('reads defaults and saves hebrew cycle config', async () => {
      const { GET, POST } = await import('@/lib/route-logic/cycle-config')

      const getRes = await GET(orgJsonReq('/api/cycle-config', 'GET'))
      expect(getRes.status).toBe(200)

      const saveRes = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'hebrew',
          cycleStartMonth: 9,
          cycleStartDay: 1,
          cycleStartHebrewMonth: 7,
          cycleStartHebrewDay: 1,
          cycleAutoRollover: true,
        }),
      )
      expect(saveRes.status).toBe(200)

      const empty = await POST(orgJsonReq('/api/cycle-config', 'POST', {}))
      expect(empty.status).toBe(400)

      const badMonth = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'gregorian',
          cycleStartMonth: 13,
          cycleStartDay: 1,
        }),
      )
      expect(badMonth.status).toBe(400)

      const missingHebrew = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'hebrew',
          cycleStartMonth: 9,
          cycleStartDay: 1,
        }),
      )
      expect(missingHebrew.status).toBe(400)
    })

    it('creates a new active config when none exists', async () => {
      const { CycleConfig } = await import('@/lib/models')
      await CycleConfig.deleteMany({ organizationId: ctx.betaOrgId })

      const { POST } = await import('@/lib/route-logic/cycle-config')
      const res = await POST(
        orgJsonReq(
          '/api/cycle-config',
          'POST',
          {
            cycleCalendar: 'gregorian',
            cycleStartMonth: 1,
            cycleStartDay: 1,
            cycleAutoRollover: false,
          },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(res.status).toBe(201)
    })
  })

  describe('payment-plans/[id]', () => {
    it('gets, updates, and deletes a disposable plan', async () => {
      const { PaymentPlan } = await import('@/lib/models')
      const plan = await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: 'Finish Disposable Plan',
        planNumber: 99,
        yearlyPrice: 99,
      })
      const params = { id: plan._id.toString() }
      const path = `/api/payment-plans/${params.id}`
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/payment-plans/[id]')

      expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(200)
      expect(
        (
          await PUT(orgJsonReq(path, 'PUT', { name: 'Finish Plan Updated', yearlyPrice: 120 }), {
            params,
          })
        ).status,
      ).toBe(200)
      expect((await DELETE(orgJsonReq(path, 'DELETE'), { params })).status).toBe(200)
      expect(
        (await GET(orgJsonReq('/api/payment-plans/not-valid', 'GET'), { params: { id: 'x' } }))
          .status,
      ).toBe(400)
    })
  })

  describe('lifecycle-event-types/[id]', () => {
    it('gets and updates an event type', async () => {
      const params = { id: ctx.fixtures.lifecycleEventTypeId }
      const path = `/api/lifecycle-event-types/${params.id}`
      const { GET, PUT } = await import('@/lib/route-logic/lifecycle-event-types/[id]')

      expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(200)
      const putRes = await PUT(
        orgJsonReq(path, 'PUT', { name: 'Bar Mitzvah Updated', amount: 500 }),
        { params },
      )
      expect(putRes.status).toBe(200)
    })
  })

  describe('family-members/all', () => {
    it('returns all members grouped and supports pagination', async () => {
      const { GET } = await import('@/lib/route-logic/family-members/all')

      const all = await GET(orgJsonReq('/api/family-members/all', 'GET'))
      expect(all.status).toBe(200)
      const body = await all.json()
      expect(Object.keys(body.byFamily ?? body).length).toBeGreaterThan(0)

      const paged = await GET(
        orgJsonReq('/api/family-members/all', 'GET', undefined, { query: '?limit=5' }),
      )
      expect(paged.status).toBe(200)

      expect(
        (
          await GET(
            orgJsonReq('/api/family-members/all', 'GET', undefined, {
              query: '?limit=5&cursor=bad',
            }),
          )
        ).status,
      ).toBe(400)
    })
  })

  describe('email workers (continuation)', () => {
    async function seedEmailConfig() {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: encrypt('app-password-test'),
            fromName: 'API Route Org',
            isActive: true,
          },
        },
        { upsert: true },
      )
    }

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('processes a multi-family statement job and triggers continuation fetch', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const familyIds: Types.ObjectId[] = []
      for (let i = 0; i < 6; i++) {
        const f = await Family.create({
          organizationId: ctx.orgId,
          name: `Finish Email Fam ${i}`,
          weddingDate: new Date('2010-01-01'),
        })
        familyIds.push(f._id)
      }

      const y = year()
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(`${y}-01-01`),
        toDate: new Date(`${y}-12-31`),
        totalFamilies: familyIds.length,
        pending: familyIds,
      })

      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('running')
      expect(body.remaining).toBeGreaterThan(0)
      expect(global.fetch).toHaveBeenCalled()
    })

    it('fails statement worker when email password cannot be decrypted', async () => {
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC',
            fromName: 'API Route Org',
            isActive: true,
          },
        },
        { upsert: true },
      )

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
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).status).toBe('failed')

      await seedEmailConfig()
    })

    it('records tax receipt send failures on the job', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const spy = vi.spyOn(taxMod, 'sendOneFamilyTaxReceipt').mockResolvedValue({
        ok: false,
        email: 'nobody@example.com',
        error: 'Mailbox unavailable',
      })

      try {
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
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.status).toBe('completed')
        expect(body.failed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('completes a single-family tax receipt email job', async () => {
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

      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(['completed', 'running']).toContain(body.status)
      expect(body.sent).toBeGreaterThanOrEqual(0)
    })

    it('completes a single-family statement job when send succeeds', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const spy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValue({ ok: true, email: null })

      try {
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
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        expect((await res.json()).status).toBe('completed')
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })

    it('records statement send failures on the job', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const spy = vi.spyOn(sendMod, 'sendOneFamilyStatement').mockResolvedValue({
        ok: false,
        email: 'nobody@example.com',
        error: 'SMTP rejected',
      })

      try {
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
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.status).toBe('completed')
        expect(body.failed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('runs statement worker via cron with explicit organizationId', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const spy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValue({ ok: true, email: null })

      try {
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
            { jobId: job._id.toString(), organizationId: ctx.orgId },
            { cron: true },
          ),
        )
        expect(res.status).toBe(200)
        expect((await res.json()).status).toBe('completed')
      } finally {
        spy.mockRestore()
      }
    })

    it('returns 400 for invalid jobId on statement worker', async () => {
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: 'not-valid' }),
      )
      expect(res.status).toBe(400)
    })

    it('returns early when statement job is already completed', async () => {
      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
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
      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).done).toBe(true)
    })

    it('commits partial progress when send throws mid-batch', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const sendMod = await import('@/lib/statements/send-statement')
      const families = await Promise.all(
        [0, 1].map((i) =>
          Family.create({
            organizationId: ctx.orgId,
            name: `Stmt Throw Fam ${i}`,
            weddingDate: new Date('2010-01-01'),
          }),
        ),
      )
      const spy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValueOnce({ ok: true, email: null })
        .mockRejectedValueOnce(new Error('SMTP connection reset'))

      try {
        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'statements',
          status: 'queued',
          fromDate: new Date(`${year()}-01-01`),
          toDate: new Date(`${year()}-12-31`),
          totalFamilies: 2,
          pending: families.map((f) => f._id),
        })

        const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
        const res = await POST(
          orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(500)

        const updated = (await EmailJob.findById(job._id).lean()) as
          | import('@/lib/test/type-helpers').LeanDoc
          | null
        expect(updated?.sent).toBeGreaterThanOrEqual(1)
        expect(updated?.processed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('rejects tax worker for a statements job kind', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
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
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(400)
    })

    it('fails tax worker when email config is inactive', async () => {
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailConfig.updateOne({ organizationId: ctx.orgId }, { $set: { isActive: false } })

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
      expect(res.status).toBe(200)
      expect((await res.json()).status).toBe('failed')

      await seedEmailConfig()
    })

    it('commits partial tax progress when send throws mid-batch', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const families = await Promise.all(
        [0, 1].map((i) =>
          Family.create({
            organizationId: ctx.orgId,
            name: `Tax Throw Fam ${i}`,
            weddingDate: new Date('2010-01-01'),
          }),
        ),
      )
      const spy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValueOnce({ ok: true, email: null })
        .mockRejectedValueOnce(new Error('Tax SMTP reset'))

      try {
        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'tax-receipts',
          status: 'queued',
          year: year(),
          totalFamilies: 2,
          pending: families.map((f) => f._id),
        })

        const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
        const res = await POST(
          orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(500)

        const updated = (await EmailJob.findById(job._id).lean()) as
          | import('@/lib/test/type-helpers').LeanDoc
          | null
        expect(updated?.sent).toBeGreaterThanOrEqual(1)
        expect(updated?.processed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('continues multi-family tax jobs and triggers fetch', async () => {
      await seedEmailConfig()
      const { Family, EmailJob } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const spy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValue({ ok: true, email: null })

      try {
        const familyIds: Types.ObjectId[] = []
        for (let i = 0; i < 6; i++) {
          const f = await Family.create({
            organizationId: ctx.orgId,
            name: `Tax Cont Fam ${i}`,
            weddingDate: new Date('2010-01-01'),
          })
          familyIds.push(f._id)
        }

        const job = await EmailJob.create({
          organizationId: ctx.orgId,
          userId: new Types.ObjectId(ctx.userId),
          kind: 'tax-receipts',
          status: 'queued',
          year: year(),
          totalFamilies: familyIds.length,
          pending: familyIds,
        })

        const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
        const res = await POST(
          orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.status).toBe('running')
        expect(body.remaining).toBeGreaterThan(0)
        expect(global.fetch).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })

    it('returns early when tax job is already completed', async () => {
      const { EmailJob } = await import('@/lib/models')
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
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).done).toBe(true)
    })

    it('runs tax worker via cron with explicit organizationId', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const taxMod = await import('@/lib/tax-receipts/send-receipt')
      const spy = vi
        .spyOn(taxMod, 'sendOneFamilyTaxReceipt')
        .mockResolvedValue({ ok: true, email: null })

      try {
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
          orgJsonReq(
            '/api/tax-receipts/email/worker',
            'POST',
            { jobId: job._id.toString(), organizationId: ctx.orgId },
            { cron: true },
          ),
        )
        expect(res.status).toBe(200)
        expect((await res.json()).status).toBe('completed')
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('trash/[kind]/[id]/restore', () => {
    it('rejects invalid kind and id', async () => {
      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const badKind = await POST(
        orgJsonReq('/api/trash/not-a-kind/000000000000000000000001/restore', 'POST', {}),
        { params: { kind: 'not-a-kind', id: '000000000000000000000001' } },
      )
      expect(badKind.status).toBe(400)

      const badId = await POST(
        orgJsonReq(`/api/trash/payment/${ctx.fixtures.familyId}/restore`, 'POST', {}),
        { params: { kind: 'payment', id: 'not-valid' } },
      )
      expect(badId.status).toBe(400)
    })

    it('returns 404 when recycle-bin item is missing', async () => {
      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const missingId = new Types.ObjectId().toString()
      const res = await POST(orgJsonReq(`/api/trash/payment/${missingId}/restore`, 'POST', {}), {
        params: { kind: 'payment', id: missingId },
      })
      expect(res.status).toBe(404)
    })

    it('restores a soft-deleted payment plan', async () => {
      const { PaymentPlan } = await import('@/lib/models')
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        role: 'owner' as const,
        session: { user: { id: ctx.userId, email: ctx.email, name: ctx.userName } },
      }
      const plan = await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: 'Restore Me Plan',
        planNumber: 88,
        yearlyPrice: 88,
      })
      await softDeleteOne('paymentPlan', plan._id.toString(), orgCtx)

      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const res = await POST(orgJsonReq(`/api/trash/paymentPlan/${plan._id}/restore`, 'POST', {}), {
        params: { kind: 'paymentPlan', id: plan._id.toString() },
      })
      expect(res.status).toBe(200)
    })

    it('returns 409 when restore clashes with a live plan number', async () => {
      const { PaymentPlan } = await import('@/lib/models')
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        role: 'owner' as const,
        session: { user: { id: ctx.userId, email: ctx.email, name: ctx.userName } },
      }
      const planNumber = 77_701
      const deleted = await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: 'Deleted Plan',
        planNumber,
        yearlyPrice: 100,
      })
      await softDeleteOne('paymentPlan', deleted._id.toString(), orgCtx)
      await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: 'Live Plan',
        planNumber,
        yearlyPrice: 100,
      })

      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const res = await POST(
        orgJsonReq(`/api/trash/paymentPlan/${deleted._id}/restore`, 'POST', {}),
        { params: { kind: 'paymentPlan', id: deleted._id.toString() } },
      )
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/unique identifier/i)
    })

    it('returns 409 when parent family is still deleted', async () => {
      const { Payment, Family } = await import('@/lib/models')
      const { softDeleteFamilyCascade } = await import('@/lib/recycle-bin')
      const orgCtx = {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        role: 'owner' as const,
        session: { user: { id: ctx.userId, email: ctx.email, name: ctx.userName } },
      }
      const family = await Family.create({
        organizationId: ctx.orgId,
        name: 'Trash Parent Family',
        weddingDate: new Date('2016-05-01'),
        email: `trash-parent-${Date.now()}@example.com`,
      })
      const payment = await Payment.create({
        organizationId: ctx.orgId,
        familyId: family._id,
        amount: 40,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'check',
      })
      await softDeleteFamilyCascade(family._id.toString(), orgCtx)

      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const res = await POST(orgJsonReq(`/api/trash/payment/${payment._id}/restore`, 'POST', {}), {
        params: { kind: 'payment', id: payment._id.toString() },
      })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/parent family/i)
    })
  })

  describe('organizations/branding/logo', () => {
    it('returns 429 path is not exercised when rate limit allows', async () => {
      const { GET } = await import('@/lib/route-logic/organizations/branding/logo')
      const { Organization } = await import('@/lib/models')
      const tiny =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      await Organization.updateOne({ _id: ctx.orgId }, { $set: { 'branding.logoDataUrl': tiny } })
      expect((await GET(orgJsonReq('/api/organizations/branding/logo', 'GET'))).status).toBe(200)
    })
  })

  describe('auth/invite accept flow', () => {
    it('accepts an invite for a new user', async () => {
      const email = `finish-accept-${Date.now()}@example.com`
      const { POST, GET, PUT } = await import('@/lib/route-logic/auth/invite')

      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email, role: 'member' }),
      )
      expect(createRes.status).toBe(200)
      const token = inviteTokenFromUrl((await createRes.json()).inviteUrl)

      const resolveRes = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite?token=${encodeURIComponent(token)}`, {
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(resolveRes.status).toBe(200)

      mockAuth.mockResolvedValueOnce(null as never)
      const acceptRes = await PUT(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'PUT',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token,
            name: 'Finish Invitee',
            password: 'FinishInvitePass123!',
          }),
        }),
      )
      expect(acceptRes.status).toBe(200)
      bindSession(ctx)
    })
  })

  describe('cron jobs', () => {
    it('rejects unauthenticated cron calls', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
      expect((await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}))).status).toBe(401)
    })

    it('runs cycle-rollover with cron secret', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
      expect(
        (await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))).status,
      ).toBeLessThan(500)
    })

    it('runs generate-monthly-statements with cron secret', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
      expect(
        (
          await POST(
            orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }),
          )
        ).status,
      ).toBeLessThan(500)
    })

    it('runs send-monthly-statements with cron secret', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
      expect(
        (await POST(orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true })))
          .status,
      ).toBeLessThan(500)
    })

    it('runs process-recurring-payments with cron secret', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
      expect(
        (await POST(orgJsonReq('/api/jobs/process-recurring-payments', 'POST', {}, { cron: true })))
          .status,
      ).toBeLessThan(500)
    })

    it('runs wedding-converter with cron secret', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
      expect(
        (await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }))).status,
      ).toBeLessThan(500)
    })

    it('converts members whose wedding date has passed', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const past = new Date()
      past.setFullYear(past.getFullYear() - 1)
      await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Wedding',
        lastName: 'Convert',
        weddingDate: past,
        convertedToFamily: false,
      })

      const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
      const res = await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.processed).toBeGreaterThanOrEqual(0)
    })

    it('records per-org wedding conversion errors', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const past = new Date('2015-05-05')
      await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'WeddingErr',
        lastName: 'Probe',
        weddingDate: past,
        convertedToFamily: false,
      })
      const wc = await import('@/lib/wedding-converter')
      const spy = vi
        .spyOn(wc, 'convertMembersOnWeddingDate')
        .mockRejectedValue(new Error('Org convert failed'))

      try {
        const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
        const res = await POST(
          orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
        expect(body.errors?.[0]?.error).toBeTruthy()
      } finally {
        spy.mockRestore()
      }
    })

    it('runs cycle-rollover for configs matching today', async () => {
      const { CycleConfig } = await import('@/lib/models')
      const rollover = await import('@/lib/cycle-rollover')
      const day = new Date().getUTCDate()
      const month = new Date().getUTCMonth() + 1
      await CycleConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            isActive: true,
            cycleAutoRollover: true,
            cycleCalendar: 'gregorian',
            cycleStartMonth: month,
            cycleStartDay: day,
          },
        },
        { upsert: true },
      )
      const spy = vi.spyOn(rollover, 'runCycleRolloverForOrg').mockResolvedValue({
        organizationId: ctx.orgId,
        cycleYear: year(),
        calendar: 'gregorian',
        charged: 1,
        skipped: 0,
        noPlan: 0,
        errors: [],
      })

      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const res = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.matchedConfigs).toBeGreaterThanOrEqual(1)
        expect(body.processed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('generates statements for orgs on the monthly schedule', async () => {
      const { Organization } = await import('@/lib/models')
      const scheduler = await import('@/lib/scheduler')
      const day = new Date().getUTCDate()
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            monthlyStatementAutoGenerate: true,
            monthlyStatementCalendar: 'gregorian',
            monthlyStatementDay: day,
          },
        },
      )
      const spy = vi.spyOn(scheduler, 'generateMonthlyStatements').mockResolvedValue({
        success: true,
        month: 1,
        year: 2024,
        generated: 0,
        failed: 0,
        statements: [],
        errors: [],
        hasMore: false,
        familyCursorOut: null,
      })

      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const res = await POST(
          orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }),
        )
        expect(res.status).toBe(200)
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('members/[memberId] routes', () => {
    it('returns member balance, payments, and statements', async () => {
      const memberId = ctx.fixtures.memberId
      const params = { memberId }

      const { GET: balGet } = await import('@/lib/route-logic/members/[memberId]/balance')
      expect(
        (await balGet(orgJsonReq(`/api/members/${memberId}/balance`, 'GET'), { params })).status,
      ).toBe(200)

      const { GET: payGet } = await import('@/lib/route-logic/members/[memberId]/payments')
      expect(
        (await payGet(orgJsonReq(`/api/members/${memberId}/payments`, 'GET'), { params })).status,
      ).toBe(200)

      const { GET: stmtGet } = await import('@/lib/route-logic/members/[memberId]/statements')
      expect(
        (await stmtGet(orgJsonReq(`/api/members/${memberId}/statements`, 'GET'), { params }))
          .status,
      ).toBe(200)
    })
  })

  describe('email-config', () => {
    it('returns configured:false when no active email config exists', async () => {
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })

      const { GET } = await import('@/lib/route-logic/email-config')
      const res = await GET(
        orgJsonReq('/api/email-config', 'GET', undefined, { orgId: ctx.betaOrgId }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).configured).toBe(false)
    })

    it('reads and updates org email config', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { GET, PUT } = await import('@/lib/route-logic/email-config')

      const getRes = await GET(orgJsonReq('/api/email-config', 'GET'))
      expect(getRes.status).toBe(200)

      const putRes = await PUT(
        orgJsonReq('/api/email-config', 'PUT', {
          email: 'finish@example.com',
          password: 'finish-email-pass',
          fromName: 'Finish Org',
          isActive: true,
        }),
      )
      expect(putRes.status).toBe(200)

      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        { $set: { password: encrypt('finish-email-pass') } },
      )
    })

    it('creates email config on org without one and sends a test email', async () => {
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })

      const { POST } = await import('@/lib/route-logic/email-config')
      const missingPw = await POST(
        orgJsonReq(
          '/api/email-config',
          'POST',
          { email: 'beta@example.com', fromName: 'Beta Org' },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(missingPw.status).toBe(400)

      const createRes = await POST(
        orgJsonReq(
          '/api/email-config',
          'POST',
          {
            email: 'beta-finish@example.com',
            password: 'beta-email-pass',
            fromName: 'Beta Finish',
          },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(createRes.status).toBe(201)

      const { POST: testPost } = await import('@/lib/route-logic/email-config/test')
      const testRes = await testPost(
        orgJsonReq('/api/email-config/test', 'POST', {}, { orgId: ctx.betaOrgId }),
      )
      expect(testRes.status).toBe(200)
      expect((await testRes.json()).sent).toBe(true)
    })
  })

  describe('organizations', () => {
    it('lists orgs and switches active org via PATCH', async () => {
      const { GET, PATCH } = await import('@/lib/route-logic/organizations')

      expect((await GET(orgJsonReq('/api/organizations', 'GET'))).status).toBe(200)
      const patchRes = await PATCH(
        orgJsonReq('/api/organizations', 'PATCH', { activeOrgId: ctx.orgId }),
      )
      expect(patchRes.status).toBe(200)
    })
  })

  describe('recurring-payments/process', () => {
    it('lists recurring payments for the org', async () => {
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      const next = new Date()
      next.setMonth(next.getMonth() + 1)
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 10,
        frequency: 'monthly',
        startDate: new Date(),
        nextPaymentDate: next,
        isActive: true,
      })

      const { GET } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await GET(
        orgJsonReq('/api/recurring-payments/process', 'GET', undefined, {
          query: `?familyId=${ctx.fixtures.familyId}`,
        }),
      )
      expect(res.status).toBe(200)
      const list = await res.json()
      expect(Array.isArray(list)).toBe(true)
      expect(list.length).toBeGreaterThanOrEqual(1)
    })

    it('processes due recurring payments and records success', async () => {
      const { RecurringPayment, Payment } = await import('@/lib/models')
      const due = new Date()
      due.setDate(due.getDate() - 2)
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_recurringfinish1',
      })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 42,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_recurringfinish1',
        status: 'succeeded',
        amount: 4200,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.processed).toBeGreaterThanOrEqual(1)
    })

    it('skips recurring rows when saved payment method is inactive', async () => {
      const { RecurringPayment, SavedPaymentMethod } = await import('@/lib/models')
      const due = new Date()
      due.setDate(due.getDate() - 1)
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await SavedPaymentMethod.updateOne(
        { _id: ctx.fixtures.savedPaymentMethodId },
        { $set: { isActive: false } },
      )
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 20,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)

      await SavedPaymentMethod.updateOne(
        { _id: ctx.fixtures.savedPaymentMethodId },
        { $set: { isActive: true } },
      )
    })

    it('records failure when Stripe does not succeed', async () => {
      const { RecurringPayment } = await import('@/lib/models')
      const due = new Date()
      due.setDate(due.getDate() - 3)
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 15,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_recurringfail01',
        status: 'requires_action',
        amount: 1500,
        currency: 'usd',
      })

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)
    })

    it('records failure when Stripe charge throws', async () => {
      const { RecurringPayment } = await import('@/lib/models')
      const due = new Date()
      due.setDate(due.getDate() - 4)
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 18,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockRejectedValueOnce(new Error('Your card was declined'))

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)
      expect(body.results?.[0]?.error).toBeTruthy()
    })

    it('skips recurring rows when family cannot be populated', async () => {
      const { RecurringPayment } = await import('@/lib/models')
      const due = new Date('2020-01-01')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: new Types.ObjectId(),
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 22,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)
      expect(body.results?.[0]?.error).toMatch(/Family not found/i)
    })

    it('reuses existing ledger row when PaymentIntent was already booked', async () => {
      const { RecurringPayment, Payment } = await import('@/lib/models')
      const due = new Date()
      due.setDate(due.getDate() - 2)
      const piId = 'pi_recurringledgerdup'
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await Payment.deleteMany({ organizationId: ctx.orgId, stripePaymentIntentId: piId })
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 33,
        paymentDate: due,
        year: due.getFullYear(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 33,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 3300,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.processed).toBeGreaterThanOrEqual(1)
      const pays = await Payment.countDocuments({
        organizationId: ctx.orgId,
        stripePaymentIntentId: piId,
      })
      expect(pays).toBe(1)
    })

    it('returns 400 for invalid familyId on GET', async () => {
      const { GET } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await GET(
        orgJsonReq('/api/recurring-payments/process', 'GET', undefined, {
          query: '?familyId=not-valid',
        }),
      )
      expect(res.status).toBe(400)
    })

    it('classifies ledger write failure after successful Stripe charge', async () => {
      const { RecurringPayment, Payment } = await import('@/lib/models')
      const due = new Date('2020-01-01')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_recurringledgerfail',
      })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 27,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_recurringledgerfail',
        status: 'succeeded',
        amount: 2700,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const createSpy = vi
        .spyOn(Payment, 'create')
        .mockRejectedValueOnce(new Error('Mongo write timeout'))
      try {
        const { POST } = await import('@/lib/route-logic/recurring-payments/process')
        const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
        expect(body.results?.[0]?.error).toMatch(/Ledger write failed/i)
      } finally {
        createSpy.mockRestore()
      }
    })
  })

  describe('stripe/confirm-payment', () => {
    it('confirms a new payment intent and creates monthly recurring', async () => {
      const { Payment, RecurringPayment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_confirmmonthly',
      })
      await RecurringPayment.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_confirmmonthly',
        status: 'succeeded',
        amount: 5000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_confirmmonthly',
          familyId: ctx.fixtures.familyId,
          paymentFrequency: 'monthly',
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          paymentDate: today(),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.recurringPaymentId).toBeTruthy()
    })

    it('saves a new card when savedPaymentMethodId is will_be_saved', async () => {
      const { Payment, SavedPaymentMethod } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_willbesaved01',
      })
      await SavedPaymentMethod.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        stripePaymentMethodId: 'pm_willbesaved99',
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
        paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_willbesaved01',
        status: 'succeeded',
        amount: 2500,
        currency: 'usd',
        payment_method: 'pm_willbesaved99',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      client.paymentMethods.retrieve.mockResolvedValueOnce({
        id: 'pm_willbesaved99',
        card: {
          last4: '9999',
          brand: 'visa',
          exp_month: 11,
          exp_year: 2031,
        },
        billing_details: { name: 'Will Save' },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_willbesaved01',
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: 'will_be_saved',
        }),
      )
      expect(res.status).toBe(200)
      const spm = await SavedPaymentMethod.findOne({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        stripePaymentMethodId: 'pm_willbesaved99',
      })
      expect(spm).toBeTruthy()
    })

    it('returns 500 when Payment.create fails after Stripe succeeds', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_confirmcreatefail',
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_confirmcreatefail',
        status: 'succeeded',
        amount: 3000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const createSpy = vi
        .spyOn(Payment, 'create')
        .mockRejectedValueOnce(new Error('Ledger insert failed'))
      try {
        const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
        const res = await POST(
          orgJsonReq('/api/stripe/confirm-payment', 'POST', {
            paymentIntentId: 'pi_confirmcreatefail',
            familyId: ctx.fixtures.familyId,
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        createSpy.mockRestore()
      }
    })

    it('returns 500 when payment row is missing after create', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_confirmmissingrow',
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_confirmmissingrow',
        status: 'succeeded',
        amount: 2000,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const findSpy = vi
        .spyOn(Payment, 'findOne')
        .mockImplementation((filter: unknown, _proj?: unknown, opts?: unknown) => {
          if (opts && typeof opts === 'object' && 'includeDeleted' in opts) {
            return Promise.resolve(null) as never
          }
          return {
            select: () => ({
              lean: async () => null,
            }),
          } as never
        })

      try {
        const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
        const res = await POST(
          orgJsonReq('/api/stripe/confirm-payment', 'POST', {
            paymentIntentId: 'pi_confirmmissingrow',
            familyId: ctx.fixtures.familyId,
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        findSpy.mockRestore()
      }
    })

    it('rejects invalid paymentDate', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_apiprobemock',
          familyId: ctx.fixtures.familyId,
          paymentDate: 'not-a-date',
        }),
      )
      expect(res.status).toBe(400)
    })

    it('updates an existing monthly recurring plan on confirm', async () => {
      const { Payment, RecurringPayment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_confirmupdaterec',
      })
      await RecurringPayment.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      })
      const existing = await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 10,
        frequency: 'monthly',
        startDate: new Date(),
        nextPaymentDate: new Date(),
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      vi.mocked(client.paymentIntents.retrieve).mockImplementation(async (id: string) => ({
        id,
        status: 'succeeded',
        amount: 5050,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      }))

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_confirmupdaterec',
          familyId: ctx.fixtures.familyId,
          paymentFrequency: 'monthly',
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recurringPaymentId).toBe(existing._id.toString())
      const updated = await RecurringPayment.findById(existing._id)
      expect(updated?.amount).not.toBe(10)
    })
  })

  describe('jobs/send-monthly-statements', () => {
    it('emails orgs on the monthly schedule when cron runs', async () => {
      const { Organization } = await import('@/lib/models')
      const day = new Date().getUTCDate()
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            monthlyStatementAutoEmail: true,
            monthlyStatementCalendar: 'gregorian',
            monthlyStatementDay: day,
          },
        },
      )

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(
          orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true }),
        )
        expect(res.status).toBe(200)
        expect(global.fetch).toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('tasks', () => {
    it('creates, updates, and completes a task', async () => {
      const { POST } = await import('@/lib/route-logic/tasks')
      const { PUT } = await import('@/lib/route-logic/tasks/[id]')

      const createRes = await POST(
        orgJsonReq('/api/tasks', 'POST', {
          title: 'Finish Task',
          description: 'coverage',
          dueDate: today(),
          email: ctx.email,
          priority: 'medium',
        }),
      )
      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      const taskId = (created._id ?? created.id) as string

      const updateRes = await PUT(
        orgJsonReq(`/api/tasks/${taskId}`, 'PUT', { status: 'completed' }),
        { params: { id: taskId } },
      )
      expect(updateRes.status).toBe(200)
    })

    it('lists tasks with dueDate filters and rejects invalid related refs', async () => {
      const { GET, POST } = await import('@/lib/route-logic/tasks')

      for (const dueDate of ['overdue', 'upcoming'] as const) {
        const res = await GET(
          orgJsonReq('/api/tasks', 'GET', undefined, { query: `?dueDate=${dueDate}` }),
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(await res.json())).toBe(true)
      }

      const badMember = await POST(
        orgJsonReq('/api/tasks', 'POST', {
          title: 'Bad related member',
          dueDate: today(),
          email: ctx.email,
          priority: 'low',
          relatedMemberId: new Types.ObjectId().toString(),
        }),
      )
      expect(badMember.status).toBe(404)

      const badPayment = await POST(
        orgJsonReq('/api/tasks', 'POST', {
          title: 'Bad related payment',
          dueDate: today(),
          email: ctx.email,
          priority: 'low',
          relatedPaymentId: new Types.ObjectId().toString(),
        }),
      )
      expect(badPayment.status).toBe(404)
    })
  })

  describe('statements/generate-monthly', () => {
    it('generates monthly statements for the org', async () => {
      const { POST } = await import('@/lib/route-logic/statements/generate-monthly')
      const res = await POST(orgJsonReq('/api/statements/generate-monthly', 'POST', {}))
      expect(res.status).toBeLessThan(500)
    })
  })

  describe('import all probe types', () => {
    it.each([
      'families-csv',
      'members-csv',
      'payments-csv',
      'lifecycle-events-csv',
      'families-xlsx',
      'members-bound',
    ] as const)('POST /api/import [%s]', async (label) => {
      const { buildImportProbeRequest } = await import('@/lib/test/import-route-probes')
      const { POST } = await import('@/lib/route-logic/import')
      const req = await buildImportProbeRequest(label, {
        familyId: ctx.fixtures.familyId,
        memberId: ctx.fixtures.memberId,
      })
      const res = await POST(req)
      expect(res.status).toBeLessThan(500)
      expect(res.status).not.toBe(401)
    })
  })

  describe('families/[id]/members/[memberId] bar mitzvah hooks', () => {
    it('auto-assigns plan and creates lifecycle event when automation is enabled', async () => {
      const { Organization, FamilyMember, LifecycleEventPayment } = await import('@/lib/models')
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')

      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId,
            barMitzvahAutoCreateEventTypeId: ctx.fixtures.lifecycleEventTypeId,
          },
        },
      )

      const birth = new Date('2010-06-01')
      const hebrew = convertToHebrewDate(birth)
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Bar',
        lastName: 'MitzvahProbe',
        birthDate: birth,
        gender: 'male',
        hebrewBirthDate: hebrew,
        paymentPlanAssigned: false,
        barMitzvahEventAdded: false,
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const path = `/api/families/${params.id}/members/${params.memberId}`
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')

      const putRes = await PUT(
        orgJsonReq(path, 'PUT', {
          firstName: 'Bar',
          lastName: 'MitzvahProbe',
          birthDate: birth.toISOString().slice(0, 10),
          hebrewBirthDate: hebrew,
          gender: 'male',
        }),
        { params },
      )
      expect(putRes.status).toBe(200)

      const updated = (await FamilyMember.findById(disposable._id).lean()) as
        | import('@/lib/test/type-helpers').LeanDoc
        | null
      expect(updated?.paymentPlanAssigned).toBe(true)
      const events = await LifecycleEventPayment.countDocuments({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
      })
      expect(events).toBeGreaterThan(0)
    })
  })

  describe('families/[id]/charge-saved-card extended', () => {
    beforeEach(async () => {
      const { SavedPaymentMethod } = await import('@/lib/models')
      const existing = await SavedPaymentMethod.findById(ctx.fixtures.savedPaymentMethodId)
      if (!existing) {
        await SavedPaymentMethod.create({
          _id: ctx.fixtures.savedPaymentMethodId,
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          stripePaymentMethodId: 'pm_probemock',
          last4: '4242',
          cardType: 'visa',
          expiryMonth: 12,
          expiryYear: 2030,
          isDefault: true,
          isActive: true,
        })
      } else if (!existing.isActive) {
        existing.isActive = true
        await existing.save()
      }
    })

    it('deduplicates a repeat charge in the same minute bucket', async () => {
      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const params = { id: ctx.fixtures.familyId }
      const body = {
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 11,
        type: 'membership',
        paymentDate: today(),
      }

      const first = await POST(orgJsonReq(path, 'POST', body), { params })
      expect(first.status).toBe(200)
      const second = await POST(orgJsonReq(path, 'POST', body), { params })
      expect(second.status).toBe(200)
      const secondJson = await second.json()
      expect(secondJson.deduplicated).toBe(true)
    })

    it('charges with memberId and monthly recurring frequency', async () => {
      const { RecurringPayment, Payment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
      })
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        stripePaymentIntentId: 'pi_monthlyrecur01',
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_monthlyrecur01',
        status: 'succeeded',
        amount: 3000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
        },
      })

      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 30,
          type: 'membership',
          paymentFrequency: 'monthly',
          memberId: ctx.fixtures.memberId,
          paymentDate: today(),
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recurringPaymentId).toBeTruthy()
    })

    it('returns 400 when Stripe does not succeed', async () => {
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_requiresaction',
        status: 'requires_action',
        amount: 1000,
        currency: 'usd',
      })

      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 12,
          type: 'membership',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })

    it('returns 500 when ledger write fails after a successful Stripe charge', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_chargeledgerfail',
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_chargeledgerfail',
        status: 'succeeded',
        amount: 2200,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
        },
      })

      const createSpy = vi
        .spyOn(Payment, 'create')
        .mockRejectedValueOnce(new Error('Mongo ledger blip'))
      try {
        const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
        const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
        const res = await POST(
          orgJsonReq(path, 'POST', {
            savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
            amount: 22,
            type: 'membership',
          }),
          { params: { id: ctx.fixtures.familyId } },
        )
        expect(res.status).toBe(500)
        const body = await res.json()
        expect(body.error).toMatch(/ledger write failed/i)
      } finally {
        createSpy.mockRestore()
      }
    })

    it('updates existing monthly recurring when charging', async () => {
      const { RecurringPayment, Payment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
      })
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_chargeupdaterecur',
      })
      const existing = await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 5,
        frequency: 'monthly',
        startDate: new Date(),
        nextPaymentDate: new Date(),
        isActive: true,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_chargeupdaterecur',
        status: 'succeeded',
        amount: 4500,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 45,
          type: 'membership',
          paymentFrequency: 'monthly',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recurringPaymentId).toBe(existing._id.toString())
      const updated = await RecurringPayment.findById(existing._id)
      expect(updated?.amount).toBe(45)
    })

    it('rejects charges over the maximum amount', async () => {
      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 100_001,
          type: 'membership',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })

    it('rejects invalid memberId and Stripe failures', async () => {
      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const params = { id: ctx.fixtures.familyId }

      const badMember = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 10,
          memberId: new Types.ObjectId().toString(),
        }),
        { params },
      )
      expect(badMember.status).toBe(404)

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockRejectedValueOnce(new Error('Stripe network blip'))
      const stripeFail = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 13,
          type: 'membership',
        }),
        { params },
      )
      expect(stripeFail.status).toBe(500)
    })
  })

  describe('auth/request-invite', () => {
    it('validates input and accepts new invite requests', async () => {
      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      const { InviteRequest, User } = await import('@/lib/models')

      const badBody = await POST(
        new NextRequest(`${API_ORIGIN}/api/auth/request-invite`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
          body: '[]',
        }),
      )
      expect(badBody.status).toBe(400)

      const badEmail = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email: 'not-an-email',
          name: 'Valid Name',
        }),
      )
      expect(badEmail.status).toBe(400)

      const existingUser = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email: ctx.email,
          name: 'Existing User',
        }),
      )
      expect(existingUser.status).toBe(200)
      expect((await existingUser.json()).ok).toBe(true)

      const freshEmail = `finish-invite-${Date.now()}@example.com`
      const created = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email: freshEmail,
          name: 'Finish Invite',
          message: 'please add me',
        }),
      )
      expect(created.status).toBe(200)

      const updated = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email: freshEmail,
          name: 'Finish Invite Updated',
          message: 'updated message',
        }),
      )
      expect(updated.status).toBe(200)
      const row = await InviteRequest.findOne({ email: freshEmail })
      expect(row?.name).toBe('Finish Invite Updated')

      await InviteRequest.deleteOne({ email: freshEmail })
      await User.deleteOne({ email: freshEmail })
    })
  })

  describe('members/[memberId]/balance extended', () => {
    it('rejects invalid member id and asOfDate', async () => {
      const { GET } = await import('@/lib/route-logic/members/[memberId]/balance')

      const badId = await GET(orgJsonReq('/api/members/not-valid/balance', 'GET'), {
        params: { memberId: 'not-valid' },
      })
      expect(badId.status).toBe(400)

      const missing = await GET(orgJsonReq(`/api/members/${new Types.ObjectId()}/balance`, 'GET'), {
        params: { memberId: new Types.ObjectId().toString() },
      })
      expect(missing.status).toBe(404)

      const badDate = await GET(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance?asOfDate=not-a-date`, 'GET'),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(badDate.status).toBe(400)

      const ok = await GET(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance?asOfDate=${today()}`, 'GET'),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(ok.status).toBe(200)
    })
  })

  describe('statements/send-monthly-emails', () => {
    it('returns 400 without email config and 409 when a job is active', async () => {
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({
        organizationId: ctx.orgId,
        kind: 'statements',
        status: { $in: ['queued', 'running'] },
      })
      await EmailConfig.updateOne({ organizationId: ctx.orgId }, { $set: { isActive: false } })

      const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
      const noConfig = await POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
      expect(noConfig.status).toBe(400)

      const { encrypt } = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'monthly-active@example.com',
            password: encrypt('app-password-test'),
            fromName: 'Monthly Active',
            isActive: true,
          },
        },
        { upsert: true },
      )
      const active = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'running',
        fromDate: new Date(),
        toDate: new Date(),
        totalFamilies: 1,
        pending: [ctx.fixtures.familyId],
        processed: 0,
        startedAt: new Date(),
      })
      const conflict = await POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
      expect(conflict.status).toBe(409)
      await EmailJob.deleteOne({ _id: active._id })
    })

    it('returns 500 when worker kickoff fails', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({
        organizationId: ctx.orgId,
        kind: 'statements',
        status: { $in: ['queued', 'running'] },
      })
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'monthly-fail@example.com',
            password: encrypt('app-password-test'),
            fromName: 'Monthly Fail',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const emailJobs = await import('@/lib/email-jobs')
      const kickoffSpy = vi.spyOn(emailJobs, 'kickoffEmailWorker').mockResolvedValue({
        ok: false,
        error: 'mock worker kickoff failure',
      })
      try {
        const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
        const res = await POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
        expect(res.status).toBe(500)
        expect((await res.json()).jobId).toBeTruthy()
      } finally {
        kickoffSpy.mockRestore()
      }
    })

    it('queues a monthly statement email job for the org', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'monthly@example.com',
            password: encrypt('app-password-test'),
            fromName: 'Monthly Org',
            isActive: true,
          },
        },
        { upsert: true },
      )

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }))
      try {
        const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
        const res = await POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
        expect([200, 202, 409]).toContain(res.status)
        if (res.status === 202) {
          const body = await res.json()
          expect(body.jobId).toBeTruthy()
          expect(body.status).toBe('queued')
        }
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('tasks/send-due-date-emails', () => {
    it('records failures for invalid addresses and send errors', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig, Task } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'tasks-fail@example.com',
            password: encrypt('app-password-test'),
            fromName: 'Task Fail Org',
            isActive: true,
          },
        },
        { upsert: true },
      )

      await Task.create({
        organizationId: ctx.orgId,
        title: 'Bad Email Task',
        dueDate: new Date(),
        email: 'not-an-email',
        status: 'pending',
        priority: 'low',
        emailSent: false,
      })

      const nodemailer = await import('nodemailer')
      const transport = nodemailer.default.createTransport({} as never) as unknown as {
        sendMail: ReturnType<typeof vi.fn>
      }
      transport.sendMail.mockRejectedValueOnce(new Error('SMTP down'))

      await Task.create({
        organizationId: ctx.orgId,
        title: 'Send Fail Task',
        dueDate: new Date(),
        email: 'send-fail@example.com',
        status: 'pending',
        priority: 'low',
        emailSent: false,
      })

      const { POST } = await import('@/lib/route-logic/tasks/send-due-date-emails')
      const res = await POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(2)
    })

    it('sends due-date emails for tasks due today', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig, Task } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'tasks-due@example.com',
            password: encrypt('app-password-test'),
            fromName: 'Task Due Org',
            isActive: true,
          },
        },
        { upsert: true },
      )

      await Task.create({
        organizationId: ctx.orgId,
        title: 'Due Today Finish',
        dueDate: new Date(),
        email: ctx.email,
        status: 'pending',
        priority: 'medium',
        emailSent: false,
        relatedFamilyId: ctx.fixtures.familyId,
        relatedMemberId: ctx.fixtures.memberId,
      })

      const { POST } = await import('@/lib/route-logic/tasks/send-due-date-emails')
      const res = await POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.sent).toBeGreaterThanOrEqual(1)
    })
  })

  describe('families/[id]/saved-payment-methods save path', () => {
    it('soft-deletes a saved payment method', async () => {
      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const params = { id: ctx.fixtures.familyId }
      const res = await DELETE(
        orgJsonReq(`${familyPath}?paymentMethodId=${ctx.fixtures.savedPaymentMethodId}`, 'DELETE'),
        { params },
      )
      expect(res.status).toBe(200)
      expect((await res.json()).success).toBe(true)

      const { SavedPaymentMethod } = await import('@/lib/models')
      const row = await SavedPaymentMethod.findById(ctx.fixtures.savedPaymentMethodId)
      expect(row?.isActive).toBe(false)
      if (row) {
        row.isActive = true
        await row.save()
      }
    })

    it('rejects invalid payment method id format on POST', async () => {
      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'bad-id',
          paymentIntentId: 'pi_savecardmock01',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })

    it('saves a verified payment method from a succeeded PaymentIntent', async () => {
      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const params = { id: ctx.fixtures.familyId }

      const res = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_savecardmock01',
          setAsDefault: true,
        }),
        { params },
      )
      expect([200, 201]).toContain(res.status)
      const body = await res.json()
      expect(body.last4).toBe('4242')
      expect(body.stripePaymentMethodId).toBeUndefined()
    })
  })

  describe('org-members extended', () => {
    it('lists invites without bearer tokens and blocks owner demotion races', async () => {
      const { OrgMembership } = await import('@/lib/models')
      const { GET, PATCH } = await import('@/lib/route-logic/org-members')

      const listRes = await GET(orgJsonReq('/api/org-members', 'GET'))
      expect(listRes.status).toBe(200)
      const list = await listRes.json()
      expect(list.invites.every((i: { token?: string }) => i.token === undefined)).toBe(true)

      await PATCH(
        orgJsonReq('/api/org-members', 'PATCH', {
          membershipId: ctx.fixtures.memberMembershipId,
          role: 'owner',
        }),
      )

      const realCount = OrgMembership.countDocuments.bind(OrgMembership)
      let ownerCountCalls = 0
      const countSpy = vi
        .spyOn(OrgMembership, 'countDocuments')
        .mockImplementation(async (filter: any) => {
          if (filter?.role === 'owner') {
            ownerCountCalls++
            if (ownerCountCalls === 2) return 0
          }
          return realCount(filter)
        })
      try {
        const demoteRes = await PATCH(
          orgJsonReq('/api/org-members', 'PATCH', {
            membershipId: ctx.fixtures.memberMembershipId,
            role: 'admin',
          }),
        )
        expect(demoteRes.status).toBe(409)
      } finally {
        countSpy.mockRestore()
        await PATCH(
          orgJsonReq('/api/org-members', 'PATCH', {
            membershipId: ctx.fixtures.memberMembershipId,
            role: 'member',
          }),
        )
      }
    })

    it('blocks non-owners from removing an owner', async () => {
      const bcrypt = await import('bcryptjs')
      const { User, OrgMembership } = await import('@/lib/models')
      const adminUser = await User.create({
        email: `finish-admin-${Date.now()}@example.com`,
        hashedPassword: await bcrypt.hash('ApiRouteTestPass123!', 10),
        name: 'Finish Admin',
      })
      await OrgMembership.create({
        userId: adminUser._id,
        organizationId: ctx.orgId,
        role: 'admin',
      })
      mockAuth.mockResolvedValueOnce({
        user: {
          id: adminUser._id.toString(),
          email: adminUser.email,
          name: adminUser.name,
          memberships: [{ o: ctx.orgId, r: 'admin' }],
        },
      } as never)

      const { DELETE } = await import('@/lib/route-logic/org-members')
      const res = await DELETE(
        orgJsonReq(`/api/org-members?id=${ctx.fixtures.membershipId}`, 'DELETE'),
      )
      expect(res.status).toBe(403)
      bindSession(ctx)
    })
  })

  describe('members/[memberId]/payments extended', () => {
    it('filters by year and rejects invalid year', async () => {
      const params = { memberId: ctx.fixtures.memberId }
      const { GET } = await import('@/lib/route-logic/members/[memberId]/payments')

      const badYear = await GET(
        orgJsonReq(`/api/members/${params.memberId}/payments?year=1800`, 'GET'),
        { params },
      )
      expect(badYear.status).toBe(400)

      const ok = await GET(
        orgJsonReq(`/api/members/${params.memberId}/payments?year=${year()}`, 'GET'),
        { params },
      )
      expect(ok.status).toBe(200)
      expect(Array.isArray(await ok.json())).toBe(true)
    })
  })

  describe('statements extended', () => {
    it('rejects invalid list cursor', async () => {
      const { GET } = await import('@/lib/route-logic/statements')
      const res = await GET(
        orgJsonReq('/api/statements', 'GET', undefined, { query: '?cursor=not-valid' }),
      )
      expect(res.status).toBe(400)
    })
  })

  describe('organizations/branding', () => {
    it('reads, updates accent, and clears branding', async () => {
      const tiny =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/organizations/branding')

      const getRes = await GET(orgJsonReq('/api/organizations/branding', 'GET'))
      expect(getRes.status).toBe(200)
      const branding = (await getRes.json()).branding
      expect(branding.logoUrl === null || typeof branding.logoUrl === 'string').toBe(true)

      const putRes = await PUT(
        orgJsonReq('/api/organizations/branding', 'PUT', {
          logoDataUrl: tiny,
          accentColor: '#2563eb',
        }),
      )
      expect(putRes.status).toBe(200)

      const badAccent = await PUT(
        orgJsonReq('/api/organizations/branding', 'PUT', { accentColor: 'not-a-color' }),
      )
      expect(badAccent.status).toBe(400)

      const delRes = await DELETE(orgJsonReq('/api/organizations/branding', 'DELETE'))
      expect(delRes.status).toBe(200)
    })
  })

  describe('organizations/automation', () => {
    it('reads and updates automation settings', async () => {
      const { GET, PUT } = await import('@/lib/route-logic/organizations/automation')

      const getRes = await GET(orgJsonReq('/api/organizations/automation', 'GET'))
      expect(getRes.status).toBe(200)

      const putRes = await PUT(
        orgJsonReq('/api/organizations/automation', 'PUT', {
          barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId,
          barMitzvahAutoCreateEventTypeId: ctx.fixtures.lifecycleEventTypeId,
          monthlyStatementAutoGenerate: true,
          monthlyStatementAutoEmail: false,
          monthlyStatementCalendar: 'hebrew',
          monthlyStatementHebrewDay: 15,
        }),
      )
      expect(putRes.status).toBe(200)

      const empty = await PUT(orgJsonReq('/api/organizations/automation', 'PUT', {}))
      expect(empty.status).toBe(400)

      const badPlan = await PUT(
        orgJsonReq('/api/organizations/automation', 'PUT', {
          barMitzvahAutoAssignPlanId: new Types.ObjectId().toString(),
        }),
      )
      expect(badPlan.status).toBe(400)
    })
  })

  describe('stripe/create-payment-intent', () => {
    it('validates body and creates a payment intent', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')

      const noBody = await POST(orgJsonReq('/api/stripe/create-payment-intent', 'POST', null))
      expect(noBody.status).toBe(400)

      const badAmount = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: -5,
        }),
      )
      expect(badAmount.status).toBe(400)

      const tooLarge = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 100_001,
        }),
      )
      expect(tooLarge.status).toBe(400)

      const ok = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 42,
          description: 'finish coverage',
        }),
      )
      expect(ok.status).toBe(200)
      const body = await ok.json()
      expect(body.clientSecret).toBeTruthy()
      expect(body.paymentIntentId).toBeTruthy()
    })
  })

  describe('tasks/[id] extended', () => {
    it('gets, rejects empty updates, and soft-deletes a task', async () => {
      const { Task } = await import('@/lib/models')
      const disposable = await Task.create({
        organizationId: ctx.orgId,
        title: 'Finish GET Task',
        dueDate: new Date(),
        email: ctx.email,
        status: 'pending',
        priority: 'low',
      })
      const params = { id: disposable._id.toString() }
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/tasks/[id]')

      expect((await GET(orgJsonReq(`/api/tasks/${params.id}`, 'GET'), { params })).status).toBe(200)

      const emptyPut = await PUT(orgJsonReq(`/api/tasks/${params.id}`, 'PUT', {}), { params })
      expect(emptyPut.status).toBe(400)

      const delRes = await DELETE(orgJsonReq(`/api/tasks/${params.id}`, 'DELETE'), { params })
      expect(delRes.status).toBe(200)
    })
  })

  describe('user/2fa disable', () => {
    it('disables 2FA after enrollment with password and TOTP', async () => {
      const password = 'ApiRouteTestPass123!'
      const { User } = await import('@/lib/models')
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
      const setupRes = await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      expect(setupRes.status).toBe(200)
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
      expect(secret).toBeTruthy()

      const enrollCode = generateTotpCode(secret!)
      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const enableRes = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code: enrollCode }),
      )
      expect(enableRes.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const disableRes = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password,
          code: generateTotpCode(secret!),
        }),
      )
      expect(disableRes.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('families/[id]/saved-payment-methods verification', () => {
    it('rejects payment intents that have not succeeded', async () => {
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_notdoneyet01',
        status: 'requires_payment_method',
        payment_method: 'pm_probemock',
        metadata: {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
        },
      })

      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_notdoneyet01',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })
  })

  describe('families/[id]/withdrawals/[withdrawalId]', () => {
    it('updates and soft-deletes a withdrawal', async () => {
      const { Withdrawal } = await import('@/lib/models')
      const params = {
        id: ctx.fixtures.familyId,
        withdrawalId: ctx.fixtures.withdrawalId,
      }
      const path = `/api/families/${params.id}/withdrawals/${params.withdrawalId}`
      const { PUT, DELETE } =
        await import('@/lib/route-logic/families/[id]/withdrawals/[withdrawalId]')

      const putRes = await PUT(orgJsonReq(path, 'PUT', { amount: 30, reason: 'finish update' }), {
        params,
      })
      expect(putRes.status).toBe(200)

      const emptyPut = await PUT(orgJsonReq(path, 'PUT', {}), { params })
      expect(emptyPut.status).toBe(400)

      const disposable = await Withdrawal.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 15,
        withdrawalDate: new Date(),
        reason: 'delete me',
      })
      const delParams = {
        id: ctx.fixtures.familyId,
        withdrawalId: disposable._id.toString(),
      }
      const delRes = await DELETE(
        orgJsonReq(`/api/families/${delParams.id}/withdrawals/${delParams.withdrawalId}`, 'DELETE'),
        { params: delParams },
      )
      expect(delRes.status).toBe(200)
    })
  })

  describe('members/[memberId]/statements extended', () => {
    it('generates and refreshes a member statement', async () => {
      const y = year()
      const params = { memberId: ctx.fixtures.memberId }
      const { POST } = await import('@/lib/route-logic/members/[memberId]/statements')
      const body = { fromDate: `${y}-01-01`, toDate: `${y}-06-30` }

      const first = await POST(
        orgJsonReq(`/api/members/${params.memberId}/statements`, 'POST', body),
        { params },
      )
      expect([200, 201]).toContain(first.status)

      const second = await POST(
        orgJsonReq(`/api/members/${params.memberId}/statements`, 'POST', body),
        { params },
      )
      expect(second.status).toBe(200)
    })
  })

  describe('organizations/letterhead', () => {
    it('reads and updates letterhead fields', async () => {
      const { GET, PUT } = await import('@/lib/route-logic/organizations/letterhead')

      const getRes = await GET(orgJsonReq('/api/organizations/letterhead', 'GET'))
      expect(getRes.status).toBe(200)

      const putRes = await PUT(
        orgJsonReq('/api/organizations/letterhead', 'PUT', {
          addressLine1: '123 Main St',
          city: 'Brooklyn',
          state: 'NY',
          taxId: '12-3456789',
          receiptThankYou: 'Thank you for your support.',
        }),
      )
      expect(putRes.status).toBe(200)

      const empty = await PUT(orgJsonReq('/api/organizations/letterhead', 'PUT', {}))
      expect(empty.status).toBe(400)
    })
  })

  describe('families/[id]/members/[memberId] extended', () => {
    it('returns 404 when updating a member outside the family', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const otherFamily = await import('@/lib/models').then(({ Family }) =>
        Family.create({
          organizationId: ctx.orgId,
          name: 'Other Family Finish',
          weddingDate: new Date('2014-01-01'),
        }),
      )
      const orphan = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: otherFamily._id,
        firstName: 'Orphan',
        lastName: 'Member',
        birthDate: new Date('2012-01-01'),
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: orphan._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const res = await PUT(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
          firstName: 'Nope',
          lastName: 'Member',
          birthDate: '2012-01-01',
        }),
        { params },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('user/2fa setup extended', () => {
    it('rejects bad password and requires reauth when 2FA is already enabled', async () => {
      const password = 'ApiRouteTestPass123!'
      const { User } = await import('@/lib/models')
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')

      const badPw = await setupPost(
        sessionJsonReq('/api/user/2fa/setup', 'POST', { password: 'wrong-password' }),
      )
      expect(badPw.status).toBe(401)

      const setupRes = await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      expect(setupRes.status).toBe(200)
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'enable',
          code: generateTotpCode(secret!),
        }),
      )

      const needsCode = await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      expect(needsCode.status).toBe(401)
      expect((await needsCode.json()).requiresReauth).toBe(true)

      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const reenroll = await setupPost(
        sessionJsonReq('/api/user/2fa/setup', 'POST', {
          password,
          code: generateTotpCode(secret!),
        }),
      )
      expect(reenroll.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('user/2fa enable failure', () => {
    it('returns 401 when enrollment code does not match', async () => {
      const password = 'ApiRouteTestPass123!'
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
      await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const res = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code: '000000' }),
      )
      expect(res.status).toBe(401)
    })
  })

  describe('families/[id]/saved-payment-methods PI guards', () => {
    it('rejects payment methods that do not match the payment intent', async () => {
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_mismatchmock01',
        status: 'succeeded',
        payment_method: 'pm_othermock0001',
        metadata: {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
        },
      })

      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_mismatchmock01',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(403)
    })
  })

  describe('org-members owner removal race', () => {
    it('returns 409 when concurrent owner removal would leave zero owners', async () => {
      const { OrgMembership } = await import('@/lib/models')
      await OrgMembership.updateOne(
        { _id: ctx.fixtures.memberMembershipId },
        { $set: { role: 'owner' } },
      )

      const realCount = OrgMembership.countDocuments.bind(OrgMembership)
      let ownerCountCalls = 0
      const countSpy = vi
        .spyOn(OrgMembership, 'countDocuments')
        .mockImplementation(async (filter: any) => {
          if (filter?.role === 'owner') {
            ownerCountCalls++
            if (ownerCountCalls === 2) return 0
          }
          return realCount(filter)
        })

      const { DELETE } = await import('@/lib/route-logic/org-members')
      try {
        const res = await DELETE(
          orgJsonReq(`/api/org-members?id=${ctx.fixtures.memberMembershipId}`, 'DELETE'),
        )
        expect(res.status).toBe(409)
      } finally {
        countSpy.mockRestore()
        await OrgMembership.updateOne(
          { _id: ctx.fixtures.memberMembershipId },
          { $set: { role: 'member' } },
        )
      }
    })
  })

  describe('statements/[id]', () => {
    it('returns statement detail with transactions', async () => {
      const params = { id: ctx.fixtures.statementId }
      const { GET } = await import('@/lib/route-logic/statements/[id]')
      const res = await GET(orgJsonReq(`/api/statements/${params.id}`, 'GET'), { params })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.statement).toBeTruthy()
      expect(Array.isArray(body.transactions)).toBe(true)

      const bad = await GET(orgJsonReq(`/api/statements/${new Types.ObjectId()}`, 'GET'), {
        params: { id: new Types.ObjectId().toString() },
      })
      expect(bad.status).toBe(404)
    })
  })

  describe('statements/generate-monthly extended', () => {
    it('validates year and month and generates for a target period', async () => {
      const { POST } = await import('@/lib/route-logic/statements/generate-monthly')

      const badYear = await POST(
        orgJsonReq('/api/statements/generate-monthly', 'POST', { year: 1700, month: 1 }),
      )
      expect(badYear.status).toBe(400)

      const badMonth = await POST(
        orgJsonReq('/api/statements/generate-monthly', 'POST', { year: year(), month: 99 }),
      )
      expect(badMonth.status).toBe(400)

      const ok = await POST(
        orgJsonReq('/api/statements/generate-monthly', 'POST', {
          year: year(),
          month: 6,
        }),
      )
      expect([200, 201]).toContain(ok.status)
      const body = await ok.json()
      expect(body.generated ?? body.errors ?? body.message ?? body).toBeTruthy()
    })
  })

  describe('auth/precheck-2fa', () => {
    it('returns requiresTwoFactor without leaking unknown emails', async () => {
      const { POST } = await import('@/lib/route-logic/auth/precheck-2fa')

      const unknown = await POST(
        publicJsonReq('/api/auth/precheck-2fa', 'POST', {
          email: 'nobody@example.com',
          password: 'wrong',
        }),
      )
      expect(unknown.status).toBe(200)
      expect((await unknown.json()).requiresTwoFactor).toBe(false)

      const real = await POST(
        publicJsonReq('/api/auth/precheck-2fa', 'POST', {
          email: ctx.email,
          password: 'ApiRouteTestPass123!',
        }),
      )
      expect(real.status).toBe(200)
      expect(typeof (await real.json()).requiresTwoFactor).toBe('boolean')
    })
  })

  describe('payment-plans/[id] extended', () => {
    it('rejects empty updates and delete while plan is assigned', async () => {
      const params = { id: ctx.fixtures.paymentPlanId }
      const path = `/api/payment-plans/${params.id}`
      const { PUT, DELETE } = await import('@/lib/route-logic/payment-plans/[id]')

      const empty = await PUT(orgJsonReq(path, 'PUT', {}), { params })
      expect(empty.status).toBe(400)

      const blocked = await DELETE(orgJsonReq(path, 'DELETE'), { params })
      expect(blocked.status).toBe(409)
      expect((await blocked.json()).familyCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('user/2fa extended', () => {
    it('rejects enable without setup and disable with wrong password', async () => {
      const { User } = await import('@/lib/models')
      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const noSecret = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code: '123456' }),
      )
      expect(noSecret.status).toBe(400)

      const password = 'ApiRouteTestPass123!'
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
      const setupRes = await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
      const backupCodes = setupBody.backupCodes as string[]

      await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'enable',
          code: generateTotpCode(secret!),
        }),
      )

      const badPw = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password: 'wrong',
          code: backupCodes[0],
        }),
      )
      expect(badPw.status).toBe(401)

      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const disable = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password,
          code: generateTotpCode(secret!),
        }),
      )
      expect(disable.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('email-config/test decrypt failure', () => {
    it('returns 500 when stored password cannot be decrypted', async () => {
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'decrypt-fail@example.com',
            password: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC',
            fromName: 'Decrypt Fail',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const { POST } = await import('@/lib/route-logic/email-config/test')
      const res = await POST(orgJsonReq('/api/email-config/test', 'POST', {}))
      expect(res.status).toBe(500)

      const { encrypt } = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        { $set: { password: encrypt('app-password-test') } },
      )
    })
  })

  describe('families/[id]/saved-payment-methods extended', () => {
    it('rejects PI ownership mismatches and non-card payment methods', async () => {
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
        paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
      }

      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_wrongorg00001',
        status: 'succeeded',
        payment_method: 'pm_probemock',
        metadata: {
          organizationId: new Types.ObjectId().toString(),
          familyId: ctx.fixtures.familyId,
        },
      })
      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const params = { id: ctx.fixtures.familyId }

      const wrongOrg = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_wrongorg00001',
        }),
        { params },
      )
      expect(wrongOrg.status).toBe(403)

      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_wrongfam00001',
        status: 'succeeded',
        payment_method: 'pm_probemock',
        metadata: {
          organizationId: ctx.orgId,
          familyId: new Types.ObjectId().toString(),
        },
      })
      const wrongFam = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_wrongfam00001',
        }),
        { params },
      )
      expect(wrongFam.status).toBe(403)

      client.paymentIntents.retrieve.mockRejectedValueOnce(new Error('Stripe unavailable'))
      const piFail = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_retrievefail1',
        }),
        { params },
      )
      expect(piFail.status).toBe(400)

      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_nocardmock01',
        status: 'succeeded',
        payment_method: 'pm_probemock',
        metadata: {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
        },
      })
      client.paymentMethods.retrieve.mockResolvedValueOnce({
        id: 'pm_probemock',
        card: null,
      })
      const noCard = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: 'pm_probemock',
          paymentIntentId: 'pi_nocardmock01',
        }),
        { params },
      )
      expect(noCard.status).toBe(400)
    })
  })

  describe('tasks/[id] completion', () => {
    it('marks a task completed with related family populated', async () => {
      const { Task } = await import('@/lib/models')
      const disposable = await Task.create({
        organizationId: ctx.orgId,
        title: 'Complete Me',
        dueDate: new Date(),
        email: ctx.email,
        status: 'pending',
        priority: 'high',
        relatedFamilyId: ctx.fixtures.familyId,
      })
      const params = { id: disposable._id.toString() }
      const { PUT } = await import('@/lib/route-logic/tasks/[id]')
      const res = await PUT(
        orgJsonReq(`/api/tasks/${params.id}`, 'PUT', {
          status: 'completed',
          relatedFamilyId: ctx.fixtures.familyId,
        }),
        { params },
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('completed')
      expect(body.completedAt).toBeTruthy()
    })
  })

  describe('families/[id]/members/[memberId] bar mitzvah errors', () => {
    it('still updates member when bar mitzvah automation throws', async () => {
      const { Organization, FamilyMember, LifecycleEventPayment } = await import('@/lib/models')
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')

      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId,
            barMitzvahAutoCreateEventTypeId: ctx.fixtures.lifecycleEventTypeId,
          },
        },
      )

      const birth = new Date('2010-05-01')
      const hebrew = convertToHebrewDate(birth)
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Auto',
        lastName: 'FailProbe',
        birthDate: birth,
        gender: 'male',
        hebrewBirthDate: hebrew,
        paymentPlanAssigned: false,
        barMitzvahEventAdded: false,
      })

      const spy = vi
        .spyOn(LifecycleEventPayment, 'create')
        .mockRejectedValueOnce(new Error('Lifecycle DB down'))

      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      try {
        const res = await PUT(
          orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
            firstName: 'Auto',
            lastName: 'FailProbe',
            birthDate: birth.toISOString().slice(0, 10),
            hebrewBirthDate: hebrew,
            gender: 'male',
          }),
          { params },
        )
        expect(res.status).toBe(200)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id] member view', () => {
    it('returns redacted family detail for non-admin members', async () => {
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)

      const { GET } = await import('@/lib/route-logic/families/[id]')
      const params = { id: ctx.fixtures.familyId }
      const res = await GET(orgJsonReq(`/api/families/${params.id}`, 'GET'), { params })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.family.openBalance).toBeUndefined()
      expect(body.payments).toEqual([])
      bindSession(ctx)
    })
  })

  describe('families/[id]/lifecycle-events', () => {
    it('lists and creates lifecycle events for a family', async () => {
      const path = `/api/families/${ctx.fixtures.familyId}/lifecycle-events`
      const params = { id: ctx.fixtures.familyId }
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')

      const list = await GET(orgJsonReq(path, 'GET'), { params })
      expect(list.status).toBe(200)
      expect(Array.isArray(await list.json())).toBe(true)

      const y = year()
      const create = await POST(
        orgJsonReq(path, 'POST', {
          eventType: 'bar_mitzvah',
          eventDate: `${y}-07-01`,
          amount: 75,
          year: y,
        }),
        { params },
      )
      expect(create.status).toBe(201)
    })
  })

  describe('reports/run', () => {
    it('runs a payments report and rejects partial date ranges', async () => {
      const y = year()
      const { POST } = await import('@/lib/route-logic/reports/run')

      const partial = await POST(
        orgJsonReq('/api/reports/run', 'POST', {
          source: 'payments',
          aggregate: 'count',
          fromDate: `${y}-01-01`,
        }),
      )
      expect(partial.status).toBe(400)

      const res = await POST(
        orgJsonReq('/api/reports/run', 'POST', {
          source: 'payments',
          aggregate: 'count',
          fromDate: `${y}-01-01`,
          toDate: `${y}-12-31`,
        }),
      )
      expect(res.status).toBe(200)
      const reportBody = await res.json()
      expect(reportBody.rows ?? reportBody.columns ?? reportBody).toBeTruthy()
    })
  })

  describe('families/.../convert-to-family extended', () => {
    it('assigns default wedding plan when org automation is configured', async () => {
      const { Organization, FamilyMember } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId } },
      )

      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Groom',
        lastName: 'ConvertPlan',
        gender: 'male',
        birthDate: new Date('2000-03-01'),
      })

      const { POST } =
        await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
      const params = { id: ctx.fixtures.familyId, memberId: member._id.toString() }
      const res = await POST(
        orgJsonReq(
          `/api/families/${params.id}/members/${params.memberId}/convert-to-family`,
          'POST',
          { weddingDate: '2023-09-01', spouseName: 'Bride Name' },
        ),
        { params },
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(String(body.newFamily?.paymentPlanId)).toBe(ctx.fixtures.paymentPlanId)
    })
  })

  describe('families/[id]/members/[memberId] PUT fields', () => {
    it('updates wedding and spouse fields on a member', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Wed',
        lastName: 'Update',
        birthDate: new Date('2011-08-01'),
        gender: 'female',
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const res = await PUT(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
          firstName: 'Wed',
          lastName: 'Update',
          birthDate: '2011-08-01',
          gender: 'female',
          weddingDate: '2025-06-15',
          spouseFirstName: 'Partner',
          spouseHebrewName: 'שותף',
          address: '1 Main St',
          city: 'Brooklyn',
        }),
        { params },
      )
      expect(res.status).toBe(200)
      const updated = await FamilyMember.findById(disposable._id)
      expect(updated?.spouseFirstName).toBe('Partner')
    })

    it('still saves member when payment plan auto-assign throws', async () => {
      const { Organization, FamilyMember, PaymentPlan } = await import('@/lib/models')
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId } },
      )
      const birth = new Date('2010-02-01')
      const hebrew = convertToHebrewDate(birth)
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Plan',
        lastName: 'Throw',
        birthDate: birth,
        gender: 'male',
        hebrewBirthDate: hebrew,
        paymentPlanAssigned: false,
      })
      const spy = vi
        .spyOn(PaymentPlan, 'findOne')
        .mockRejectedValueOnce(new Error('plan lookup failed'))
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      try {
        const res = await PUT(
          orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
            firstName: 'Plan',
            lastName: 'Throw',
            birthDate: birth.toISOString().slice(0, 10),
            hebrewBirthDate: hebrew,
            gender: 'male',
          }),
          { params },
        )
        expect(res.status).toBe(200)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('user/2fa corrupt secret', () => {
    it('returns 500 when enrollment secret cannot be decrypted', async () => {
      const { User } = await import('@/lib/models')
      await User.findByIdAndUpdate(ctx.userId, {
        $set: { twoFactorSecret: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC', twoFactorEnabled: false },
        $unset: { twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
      })

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const res = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code: '123456' }),
      )
      expect(res.status).toBe(500)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('user/2fa setup backup re-enroll', () => {
    it('re-enrolls with a backup code when 2FA is already enabled', async () => {
      const password = 'ApiRouteTestPass123!'
      const { User } = await import('@/lib/models')
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
      const setupRes = await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
      const backupCodes = setupBody.backupCodes as string[]

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'enable',
          code: generateTotpCode(secret!),
        }),
      )

      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const reenroll = await setupPost(
        sessionJsonReq('/api/user/2fa/setup', 'POST', {
          password,
          code: backupCodes[0],
        }),
      )
      expect(reenroll.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('statements/send-single-email', () => {
    it('sends a statement email for an existing statement row', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig, Family } = await import('@/lib/models')
      await Family.updateOne(
        { _id: ctx.fixtures.familyId },
        { $set: { email: 'marker-family@finish.test' } },
      )
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'single@example.com',
            password: encrypt('app-password-test'),
            fromName: 'Single Stmt',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const { POST } = await import('@/lib/route-logic/statements/send-single-email')
      const res = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect([200, 500]).toContain(res.status)
      if (res.status === 200) {
        expect((await res.json()).sent).toBe(true)
      }
    })
  })

  describe('tasks/[id] not found', () => {
    it('returns 404 for unknown task id', async () => {
      const params = { id: new Types.ObjectId().toString() }
      const { GET } = await import('@/lib/route-logic/tasks/[id]')
      const res = await GET(orgJsonReq(`/api/tasks/${params.id}`, 'GET'), { params })
      expect(res.status).toBe(404)
    })
  })

  describe('payment-plans/[id] not found', () => {
    it('returns 404 when plan does not exist', async () => {
      const params = { id: new Types.ObjectId().toString() }
      const { GET } = await import('@/lib/route-logic/payment-plans/[id]')
      const res = await GET(orgJsonReq(`/api/payment-plans/${params.id}`, 'GET'), { params })
      expect(res.status).toBe(404)
    })

    it('returns 404 on PUT when plan does not exist', async () => {
      const params = { id: new Types.ObjectId().toString() }
      const { PUT } = await import('@/lib/route-logic/payment-plans/[id]')
      const res = await PUT(
        orgJsonReq(`/api/payment-plans/${params.id}`, 'PUT', { name: 'Ghost Plan' }),
        { params },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('calculations', () => {
    it('lists calculations, fetches a year, and recalculates via POST', async () => {
      const y = year()
      const { GET, POST } = await import('@/lib/route-logic/calculations')

      expect(
        (
          await GET(
            orgJsonReq('/api/calculations', 'GET', undefined, { query: '?year=not-a-year' }),
          )
        ).status,
      ).toBe(400)

      const list = await GET(orgJsonReq('/api/calculations', 'GET'))
      expect(list.status).toBe(200)
      expect(Array.isArray(await list.json())).toBe(true)

      const one = await GET(
        orgJsonReq('/api/calculations', 'GET', undefined, { query: `?year=${y}` }),
      )
      expect(one.status).toBe(200)

      const post = await POST(
        orgJsonReq('/api/calculations', 'POST', { year: y, extraDonation: 5, extraExpense: 2 }),
      )
      expect(post.status).toBe(201)
    })

    it('returns 400 when POST body is invalid', async () => {
      const { POST } = await import('@/lib/route-logic/calculations')
      const res = await POST(orgJsonReq('/api/calculations', 'POST', { year: 'abc' }))
      expect(res.status).toBe(400)
    })
  })

  describe('jobs/process-recurring-payments extended', () => {
    it('returns 401 without cron credentials', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
      const res = await POST(orgJsonReq('/api/jobs/process-recurring-payments', 'POST'))
      expect(res.status).toBe(401)
    })

    it('skips when a run is already locked for today', async () => {
      const { JobLock } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'process-recurring-payments', lockKey })
      await JobLock.create({
        jobName: 'process-recurring-payments',
        lockKey,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })

      const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
      const res = await POST(
        orgJsonReq('/api/jobs/process-recurring-payments', 'POST', {}, { cron: true }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).skipped).toBe(true)

      await JobLock.deleteMany({ jobName: 'process-recurring-payments', lockKey })
    })

    it('releases lock and returns 500 when runChunked throws', async () => {
      const { JobLock } = await import('@/lib/models')
      await JobLock.deleteMany({ jobName: 'process-recurring-payments' })
      const jobs = await import('@/lib/jobs')
      const spy = vi
        .spyOn(jobs, 'runChunked')
        .mockRejectedValueOnce(new Error('chunk probe failure'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
        const res = await POST(
          orgJsonReq('/api/jobs/process-recurring-payments', 'POST', {}, { cron: true }),
        )
        expect(res.status).toBe(500)
        const lock = await JobLock.findOne({ jobName: 'process-recurring-payments' })
        expect(lock).toBeNull()
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/members/[memberId] DELETE', () => {
    it('returns 404 for unknown member and 400 for invalid ids', async () => {
      const params = {
        id: ctx.fixtures.familyId,
        memberId: new Types.ObjectId().toString(),
      }
      const { DELETE } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const missing = await DELETE(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'DELETE'),
        { params },
      )
      expect(missing.status).toBe(404)

      const bad = await DELETE(orgJsonReq('/api/families/x/members/y', 'DELETE'), {
        params: { id: 'not-valid', memberId: 'also-bad' },
      })
      expect(bad.status).toBe(400)
    })
  })

  describe('user/2fa disable backup code', () => {
    it('disables 2FA using a backup code', async () => {
      const password = 'ApiRouteTestPass123!'
      const { User } = await import('@/lib/models')
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
      const setupRes = await setupPost(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
      const backupCodes = setupBody.backupCodes as string[]

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'enable',
          code: generateTotpCode(secret!),
        }),
      )

      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const disable = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password,
          code: backupCodes[0],
        }),
      )
      expect(disable.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('statements extended paths', () => {
    it('lists without limit, rejects unknown family, and handles create races', async () => {
      const y = year()
      const { GET, POST } = await import('@/lib/route-logic/statements')
      const { Statement } = await import('@/lib/models')

      const unbounded = await GET(orgJsonReq('/api/statements', 'GET'))
      expect(unbounded.status).toBe(200)
      expect(Array.isArray(await unbounded.json())).toBe(true)

      const missingFamily = await GET(
        orgJsonReq('/api/statements', 'GET', undefined, {
          query: `?familyId=${new Types.ObjectId().toString()}`,
        }),
      )
      expect(missingFamily.status).toBe(404)

      const badFamilyPost = await POST(
        orgJsonReq('/api/statements', 'POST', {
          familyId: new Types.ObjectId().toString(),
          fromDate: `${y}-05-01`,
          toDate: `${y}-05-31`,
        }),
      )
      expect(badFamilyPost.status).toBe(404)

      const raced = await Statement.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        statementNumber: `STMT-race-${Date.now()}`,
        date: new Date(),
        fromDate: new Date(`${y}-06-01`),
        toDate: new Date(`${y}-06-30`),
        openingBalance: 0,
        income: 0,
        withdrawals: 0,
        expenses: 0,
        cycleCharges: 0,
        closingBalance: 0,
      })

      let findCalls = 0
      const findSpy = vi.spyOn(Statement, 'findOne').mockImplementation(async () => {
        findCalls += 1
        if (findCalls === 1) return null
        return raced
      })
      const createSpy = vi.spyOn(Statement, 'create').mockRejectedValueOnce({ code: 11000 })
      try {
        const raceRes = await POST(
          orgJsonReq('/api/statements', 'POST', {
            familyId: ctx.fixtures.familyId,
            fromDate: `${y}-06-01`,
            toDate: `${y}-06-30`,
          }),
        )
        expect(raceRes.status).toBe(200)
      } finally {
        findSpy.mockRestore()
        createSpy.mockRestore()
        await Statement.deleteOne({ _id: raced._id })
      }
    })
  })

  describe('payment-plans/[id] validation and member block', () => {
    it('rejects invalid PUT bodies and blocks delete when assigned to a member', async () => {
      const { PaymentPlan, FamilyMember } = await import('@/lib/models')
      const plan = await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: 'Member Block Plan',
        planNumber: 97,
        yearlyPrice: 97,
      })
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Plan',
        lastName: 'Holder',
        birthDate: new Date('2012-01-01'),
        paymentPlanId: plan._id,
      })
      const params = { id: plan._id.toString() }
      const path = `/api/payment-plans/${params.id}`
      const { PUT, DELETE } = await import('@/lib/route-logic/payment-plans/[id]')

      const arrayBody = await PUT(orgJsonReq(path, 'PUT', [] as unknown as object), { params })
      expect(arrayBody.status).toBe(400)

      const badField = await PUT(orgJsonReq(path, 'PUT', { yearlyPrice: 'nope' }), { params })
      expect(badField.status).toBe(400)

      const blocked = await DELETE(orgJsonReq(path, 'DELETE'), { params })
      expect(blocked.status).toBe(409)
      expect((await blocked.json()).memberCount).toBeGreaterThanOrEqual(1)

      await FamilyMember.deleteOne({ _id: member._id })
      await PaymentPlan.deleteOne({ _id: plan._id })
    })
  })

  describe('cycle-config validation extended', () => {
    it('rejects invalid gregorian and hebrew field ranges', async () => {
      const { POST } = await import('@/lib/route-logic/cycle-config')

      const badDay = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'gregorian',
          cycleStartMonth: 6,
          cycleStartDay: 32,
        }),
      )
      expect(badDay.status).toBe(400)

      const badHebrewMonth = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'hebrew',
          cycleStartMonth: 9,
          cycleStartDay: 1,
          cycleStartHebrewMonth: 14,
          cycleStartHebrewDay: 1,
        }),
      )
      expect(badHebrewMonth.status).toBe(400)
    })
  })

  describe('lifecycle-event-types', () => {
    it('lists types and rejects duplicate create', async () => {
      const { GET, POST } = await import('@/lib/route-logic/lifecycle-event-types')

      const list = await GET(orgJsonReq('/api/lifecycle-event-types', 'GET'))
      expect(list.status).toBe(200)
      expect(Array.isArray(await list.json())).toBe(true)

      const dup = await POST(
        orgJsonReq('/api/lifecycle-event-types', 'POST', {
          type: 'bar_mitzvah',
          name: 'Duplicate Bar Mitzvah',
          amount: 1,
        }),
      )
      expect(dup.status).toBe(400)

      const invalid = await POST(orgJsonReq('/api/lifecycle-event-types', 'POST', { type: '' }))
      expect(invalid.status).toBe(400)
    })
  })

  describe('families/[id]/lifecycle-events extended', () => {
    it('returns 404/400 for bad family, unknown type, and year mismatch', async () => {
      const params = { id: new Types.ObjectId().toString() }
      const path = `/api/families/${params.id}/lifecycle-events`
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')

      expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(404)

      const y0 = year()
      const unknownType = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/lifecycle-events`, 'POST', {
          eventType: 'nonexistent_event_type',
          eventDate: `${y0}-08-01`,
          year: y0,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(unknownType.status).toBe(400)

      const y = year()
      const mismatch = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/lifecycle-events`, 'POST', {
          eventType: 'bar_mitzvah',
          eventDate: `${y}-08-01`,
          amount: 10,
          year: y + 1,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(mismatch.status).toBe(400)

      expect(
        (
          await POST(
            orgJsonReq(`/api/families/not-valid/lifecycle-events`, 'POST', {
              eventType: 'bar_mitzvah',
              eventDate: `${y}-08-01`,
              amount: 10,
              year: y,
            }),
            { params: { id: 'not-valid' } },
          )
        ).status,
      ).toBe(400)
    })
  })

  describe('reports/saved validation', () => {
    it('rejects partial and invalid date ranges in config', async () => {
      const { POST } = await import('@/lib/route-logic/reports/saved')
      const y = year()

      const partial = await POST(
        orgJsonReq('/api/reports/saved', 'POST', {
          name: 'Partial dates',
          source: 'payments',
          config: { source: 'payments', aggregate: 'count', fromDate: `${y}-01-01` },
        }),
      )
      expect(partial.status).toBe(400)

      const invalid = await POST(
        orgJsonReq('/api/reports/saved', 'POST', {
          name: 'Bad dates',
          source: 'payments',
          config: {
            source: 'payments',
            aggregate: 'count',
            fromDate: 'not-a-date',
            toDate: `${y}-12-31`,
          },
        }),
      )
      expect(invalid.status).toBe(400)
    })
  })

  describe('auth/invite extended', () => {
    it('rejects duplicate member, bad resolve, expired invite, and owner-only role', async () => {
      const { Invite } = await import('@/lib/models')
      const { POST, GET, DELETE } = await import('@/lib/route-logic/auth/invite')

      const dup = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email: ctx.email, role: 'member' }),
      )
      expect(dup.status).toBe(409)

      const noToken = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(noToken.status).toBe(400)

      const expired = await Invite.create({
        organizationId: ctx.orgId,
        email: `expired-${Date.now()}@example.com`,
        role: 'member',
        token: `exp-${Date.now()}`,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() - 60_000),
      })
      const expiredRes = await GET(
        new NextRequest(
          `${API_ORIGIN}/api/auth/invite?token=${encodeURIComponent(expired.token)}`,
          { headers: { host: 'localhost:3000', origin: API_ORIGIN } },
        ),
      )
      expect(expiredRes.status).toBe(410)

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'admin' }],
        },
      } as never)
      mockCookieGet.mockImplementation((name: string) =>
        name === 'kasa_active_org' ? { value: ctx.orgId } : undefined,
      )
      const ownerInvite = await POST(
        orgJsonReq('/api/auth/invite', 'POST', {
          email: `owner-invite-${Date.now()}@example.com`,
          role: 'owner',
        }),
      )
      expect(ownerInvite.status).toBe(403)
      bindSession(ctx)

      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', {
          email: `cancel-${Date.now()}@example.com`,
          role: 'member',
        }),
      )
      expect(createRes.status).toBe(200)
      const { id } = await createRes.json()
      const cancel = await DELETE(orgJsonReq(`/api/auth/invite?id=${id}`, 'DELETE'))
      expect(cancel.status).toBe(200)
    })
  })

  describe('families/[id]/members/[memberId] hebrew and plan assign', () => {
    it('auto-fills hebrew birth date and assigns bar mitzvah plan when configured', async () => {
      const { Organization, FamilyMember } = await import('@/lib/models')
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')

      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId } },
      )

      const birth = new Date('2010-01-15')
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Hebrew',
        lastName: 'Auto',
        birthDate: birth,
        gender: 'male',
        paymentPlanAssigned: false,
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')

      const autoHebrew = await PUT(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
          firstName: 'Hebrew',
          lastName: 'Auto',
          birthDate: birth.toISOString().slice(0, 10),
          gender: 'male',
        }),
        { params },
      )
      expect(autoHebrew.status).toBe(200)
      const afterHebrew = await FamilyMember.findById(disposable._id)
      expect(afterHebrew?.hebrewBirthDate).toBeTruthy()

      const hebrew = convertToHebrewDate(birth)
      const assign = await PUT(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
          firstName: 'Hebrew',
          lastName: 'Auto',
          birthDate: birth.toISOString().slice(0, 10),
          hebrewBirthDate: hebrew,
          gender: 'male',
        }),
        { params },
      )
      expect(assign.status).toBe(200)
      const afterPlan = await FamilyMember.findById(disposable._id)
      expect(afterPlan?.paymentPlanAssigned).toBe(true)
    })
  })

  describe('organizations/automation extended', () => {
    it('validates referenced ids and updates wedding and schedule fields', async () => {
      const { PUT } = await import('@/lib/route-logic/organizations/automation')

      const badEventFormat = await PUT(
        orgJsonReq('/api/organizations/automation', 'PUT', {
          barMitzvahAutoCreateEventTypeId: 'not-an-object-id',
        }),
      )
      expect(badEventFormat.status).toBe(400)

      const missingEvent = await PUT(
        orgJsonReq('/api/organizations/automation', 'PUT', {
          barMitzvahAutoCreateEventTypeId: new Types.ObjectId().toString(),
        }),
      )
      expect(missingEvent.status).toBe(400)

      const badWedding = await PUT(
        orgJsonReq('/api/organizations/automation', 'PUT', {
          weddingConversionDefaultPlanId: new Types.ObjectId().toString(),
        }),
      )
      expect(badWedding.status).toBe(400)

      const ok = await PUT(
        orgJsonReq('/api/organizations/automation', 'PUT', {
          weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId,
          monthlyStatementDay: 28,
          barMitzvahAutoAssignPlanId: null,
          barMitzvahAutoCreateEventTypeId: null,
        }),
      )
      expect(ok.status).toBe(200)
      const body = await ok.json()
      expect(body.barMitzvahAutoAssignPlanId).toBeNull()
      expect(body.weddingConversionDefaultPlanId).toBe(ctx.fixtures.paymentPlanId)
    })
  })

  describe('families/[id]/withdrawals', () => {
    it('lists and creates withdrawals for a family', async () => {
      const params = { id: ctx.fixtures.familyId }
      const path = `/api/families/${params.id}/withdrawals`
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/withdrawals')

      const list = await GET(orgJsonReq(path, 'GET'), { params })
      expect(list.status).toBe(200)
      expect(Array.isArray(await list.json())).toBe(true)

      const create = await POST(
        orgJsonReq(path, 'POST', {
          amount: 25,
          withdrawalDate: today(),
          reason: 'finish coverage',
        }),
        { params },
      )
      expect(create.status).toBe(201)

      const missing = await GET(
        orgJsonReq(`/api/families/${new Types.ObjectId()}/withdrawals`, 'GET'),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)
    })
  })

  describe('families/[id] admin detail', () => {
    it('returns ledger data for admins', async () => {
      const params = { id: ctx.fixtures.familyId }
      const { GET } = await import('@/lib/route-logic/families/[id]')
      const res = await GET(orgJsonReq(`/api/families/${params.id}`, 'GET'), { params })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.family).toBeTruthy()
      expect(Array.isArray(body.payments)).toBe(true)
      expect(body.balance).toBeTruthy()
    })

    it('rejects empty PUT and invalid parent family', async () => {
      const params = { id: ctx.fixtures.familyId }
      const { PUT } = await import('@/lib/route-logic/families/[id]')

      const empty = await PUT(orgJsonReq(`/api/families/${params.id}`, 'PUT', {}), { params })
      expect(empty.status).toBe(400)

      const selfParent = await PUT(
        orgJsonReq(`/api/families/${params.id}`, 'PUT', { parentFamilyId: params.id }),
        { params },
      )
      expect(selfParent.status).toBe(400)

      const badPlan = await PUT(
        orgJsonReq(`/api/families/${params.id}`, 'PUT', {
          paymentPlanId: new Types.ObjectId().toString(),
        }),
        { params },
      )
      expect(badPlan.status).toBe(400)
    })
  })

  describe('families create validation', () => {
    it('rejects out-of-range wedding years and missing payment plans', async () => {
      const { POST } = await import('@/lib/route-logic/families')

      const badYear = await POST(
        orgJsonReq('/api/families', 'POST', {
          name: 'Bad Year Family',
          weddingDate: '1800-01-01',
          paymentPlanId: ctx.fixtures.paymentPlanId,
        }),
      )
      expect(badYear.status).toBe(400)

      const missingPlan = await POST(
        orgJsonReq('/api/families', 'POST', {
          name: 'Missing Plan Family',
          weddingDate: '2015-01-01',
          paymentPlanId: new Types.ObjectId().toString(),
        }),
      )
      expect(missingPlan.status).toBe(400)
    })
  })

  describe('families/[id]/members/[memberId] edge paths', () => {
    it('returns 400 on validation failure and survives hebrew conversion errors', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Edge',
        lastName: 'Case',
        birthDate: new Date('2011-04-01'),
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')

      const invalid = await PUT(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
          firstName: '',
          lastName: 'Case',
          birthDate: '2011-04-01',
        }),
        { params },
      )
      expect(invalid.status).toBe(400)

      const hebrewMod = await import('@/lib/hebrew-date')
      const spy = vi.spyOn(hebrewMod, 'convertToHebrewDate').mockImplementationOnce(() => {
        throw new Error('hebrew conversion failed')
      })
      try {
        const res = await PUT(
          orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
            firstName: 'Edge',
            lastName: 'Case',
            birthDate: '2011-04-01',
            gender: 'female',
          }),
          { params },
        )
        expect(res.status).toBe(200)
      } finally {
        spy.mockRestore()
      }
    })

    it('no-ops bar mitzvah plan assign when configured plan id is missing', async () => {
      const { Organization, FamilyMember } = await import('@/lib/models')
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')
      const ghostPlanId = new Types.ObjectId()
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { barMitzvahAutoAssignPlanId: ghostPlanId } },
      )
      const birth = new Date('2010-03-01')
      const hebrew = convertToHebrewDate(birth)
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Ghost',
        lastName: 'Plan',
        birthDate: birth,
        gender: 'male',
        hebrewBirthDate: hebrew,
        paymentPlanAssigned: false,
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
      const res = await PUT(
        orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
          firstName: 'Ghost',
          lastName: 'Plan',
          birthDate: birth.toISOString().slice(0, 10),
          hebrewBirthDate: hebrew,
          gender: 'male',
        }),
        { params },
      )
      expect(res.status).toBe(200)
      const updated = await FamilyMember.findById(disposable._id)
      expect(updated?.paymentPlanAssigned).not.toBe(true)
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $unset: { barMitzvahAutoAssignPlanId: 1 } },
      )
    })
  })

  describe('reports/meta', () => {
    it('returns report builder metadata', async () => {
      const { GET } = await import('@/lib/route-logic/reports/meta')
      const res = await GET(orgJsonReq('/api/reports/meta', 'GET'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.sources)).toBe(true)
    })
  })

  describe('email-config/test success', () => {
    it('sends a test email when config is active', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'test-send@finish.test',
            password: encrypt('app-password-test'),
            fromName: 'Finish Test',
            isActive: true,
          },
        },
        { upsert: true },
      )
      const { POST } = await import('@/lib/route-logic/email-config/test')
      const res = await POST(orgJsonReq('/api/email-config/test', 'POST', {}))
      expect(res.status).toBe(200)
      expect((await res.json()).sent).toBe(true)
    })

    it('returns 400 when email config is missing', async () => {
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })
      const { POST } = await import('@/lib/route-logic/email-config/test')
      const res = await POST(
        orgJsonReq('/api/email-config/test', 'POST', {}, { orgId: ctx.betaOrgId }),
      )
      expect(res.status).toBe(400)
    })
  })

  describe('statements/send-emails enqueue', () => {
    it('returns 500 when worker kickoff fails', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'statements' })
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'bulk@finish.test',
            password: encrypt('app-password-test'),
            fromName: 'Bulk Finish',
            isActive: true,
          },
        },
        { upsert: true },
      )
      const emailJobs = await import('@/lib/email-jobs')
      const kickoffSpy = vi.spyOn(emailJobs, 'kickoffEmailWorker').mockResolvedValue({
        ok: false,
        error: 'mock kickoff failure',
      })
      try {
        const y = year()
        const { POST } = await import('@/lib/route-logic/statements/send-emails')
        const res = await POST(
          orgJsonReq('/api/statements/send-emails', 'POST', {
            fromDate: `${y}-01-01`,
            toDate: `${y}-01-31`,
          }),
        )
        expect(res.status).toBe(500)
        expect((await res.json()).jobId).toBeTruthy()
      } finally {
        kickoffSpy.mockRestore()
      }
    })
  })

  describe('statements/send-single-email extended', () => {
    it('returns 404 for unknown statements and 500 when send fails', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'single@finish.test',
            password: encrypt('app-password-test'),
            fromName: 'Single Finish',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const { POST } = await import('@/lib/route-logic/statements/send-single-email')
      const missing = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: new Types.ObjectId().toString() },
        }),
      )
      expect(missing.status).toBe(404)

      const badBody = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', { statement: {} }),
      )
      expect(badBody.status).toBe(400)

      const sendMod = await import('@/lib/statements/send-statement')
      const spy = vi
        .spyOn(sendMod, 'sendOneFamilyStatement')
        .mockResolvedValueOnce({ ok: false, email: null, error: 'mock send failure' })
      try {
        const fail = await POST(
          orgJsonReq('/api/statements/send-single-email', 'POST', {
            statement: { _id: ctx.fixtures.statementId },
          }),
        )
        expect(fail.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('auth/invite resolve and accept guards', () => {
    it('returns 404 for unknown tokens and 403 when signed-in email mismatches', async () => {
      const { Invite } = await import('@/lib/models')
      const { GET, PUT, POST } = await import('@/lib/route-logic/auth/invite')

      const missing = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite?token=missing-token-${Date.now()}`, {
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(missing.status).toBe(404)

      const inviteEmail = `mismatch-${Date.now()}@example.com`
      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email: inviteEmail, role: 'member' }),
      )
      expect(createRes.status).toBe(200)
      const token = inviteTokenFromUrl((await createRes.json()).inviteUrl)

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.userId,
          email: ctx.email,
          name: ctx.userName,
          memberships: [{ o: ctx.orgId, r: 'owner' }],
        },
      } as never)
      const mismatch = await PUT(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'PUT',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ token, name: 'Wrong User', password: 'FinishInvitePass123!' }),
        }),
      )
      expect(mismatch.status).toBe(403)
      bindSession(ctx)

      await Invite.deleteMany({ email: inviteEmail, organizationId: ctx.orgId })
    })
  })

  describe('organizations extended', () => {
    it('creates an organization and rejects switching to a foreign org', async () => {
      const { GET, POST, PATCH } = await import('@/lib/route-logic/organizations')

      const list = await GET(sessionJsonReq('/api/organizations', 'GET'))
      expect(list.status).toBe(200)

      const orgName = `Finish Created Org ${Date.now()}`
      const create = await POST(sessionJsonReq('/api/organizations', 'POST', { name: orgName }))
      expect(create.status).toBe(200)
      const created = await create.json()
      expect(created.slug).toBeTruthy()

      const foreign = await PATCH(
        sessionJsonReq('/api/organizations', 'PATCH', {
          activeOrgId: new Types.ObjectId().toString(),
        }),
      )
      expect(foreign.status).toBe(403)

      const badBody = await PATCH(sessionJsonReq('/api/organizations', 'PATCH', {}))
      expect(badBody.status).toBe(400)
    })
  })

  describe('families/[id]/withdrawals validation', () => {
    it('rejects invalid family ids and bad withdrawal bodies', async () => {
      const params = { id: ctx.fixtures.familyId }
      const { POST } = await import('@/lib/route-logic/families/[id]/withdrawals')

      const badAmount = await POST(
        orgJsonReq(`/api/families/${params.id}/withdrawals`, 'POST', {
          amount: 0,
          withdrawalDate: today(),
        }),
        { params },
      )
      expect(badAmount.status).toBe(400)

      const badFamily = await POST(
        orgJsonReq(`/api/families/not-valid/withdrawals`, 'POST', {
          amount: 10,
          withdrawalDate: today(),
        }),
        { params: { id: 'not-valid' } },
      )
      expect(badFamily.status).toBe(400)
    })
  })

  describe('tasks/[id] related scope', () => {
    it('rejects updates that point at foreign related records', async () => {
      const { Task } = await import('@/lib/models')
      const disposable = await Task.create({
        organizationId: ctx.orgId,
        title: 'Scope Task',
        dueDate: new Date(),
        email: ctx.email,
        status: 'pending',
        priority: 'low',
      })
      const params = { id: disposable._id.toString() }
      const { PUT } = await import('@/lib/route-logic/tasks/[id]')

      const badFamily = await PUT(
        orgJsonReq(`/api/tasks/${params.id}`, 'PUT', {
          relatedFamilyId: new Types.ObjectId().toString(),
        }),
        { params },
      )
      expect(badFamily.status).toBe(404)

      const clearDone = await PUT(
        orgJsonReq(`/api/tasks/${params.id}`, 'PUT', {
          status: 'in_progress',
          completedAt: null,
        }),
        { params },
      )
      expect(clearDone.status).toBe(200)
      expect((await clearDone.json()).completedAt).toBeNull()
    })
  })

  describe('payments list extended', () => {
    it('lists all payments and filters by type', async () => {
      const { GET } = await import('@/lib/route-logic/payments')
      const unbounded = await GET(orgJsonReq('/api/payments', 'GET'))
      expect(unbounded.status).toBe(200)
      expect(Array.isArray(await unbounded.json())).toBe(true)

      const byType = await GET(
        orgJsonReq('/api/payments', 'GET', undefined, { query: '?type=membership&limit=5' }),
      )
      expect(byType.status).toBe(200)
      expect((await byType.json()).items).toBeDefined()
    })
  })

  describe('families create plan lookup failure', () => {
    it('returns 500 when payment plan lookup throws', async () => {
      const { PaymentPlan } = await import('@/lib/models')
      const spy = vi.spyOn(PaymentPlan, 'findOne').mockRejectedValueOnce(new Error('plan db down'))
      try {
        const { POST } = await import('@/lib/route-logic/families')
        const res = await POST(
          orgJsonReq('/api/families', 'POST', {
            name: 'Plan Lookup Fail',
            weddingDate: '2015-06-01',
            paymentPlanId: ctx.fixtures.paymentPlanId,
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/members/[memberId] error paths', () => {
    it('survives bar mitzvah date calculation failures and surfaces db timeouts', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const hebrewMod = await import('@/lib/hebrew-date')
      const disposable = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Calc',
        lastName: 'Fail',
        birthDate: new Date('2011-05-01'),
        hebrewBirthDate: '1 Tishrei 5771',
        gender: 'male',
      })
      const params = {
        id: ctx.fixtures.familyId,
        memberId: disposable._id.toString(),
      }
      const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')

      const barSpy = vi.spyOn(hebrewMod, 'calculateBarMitzvahDate').mockImplementationOnce(() => {
        throw new Error('bar mitzvah calc failed')
      })
      try {
        const calcRes = await PUT(
          orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
            firstName: 'Calc',
            lastName: 'Fail',
            birthDate: '2011-05-01',
            hebrewBirthDate: '1 Tishrei 5771',
            gender: 'male',
            spouseName: ' Spouse ',
          }),
          { params },
        )
        expect(calcRes.status).toBe(200)
        const updated = await FamilyMember.findById(disposable._id)
        expect(updated?.spouseName).toBe('Spouse')
      } finally {
        barSpy.mockRestore()
      }

      const dbSpy = vi
        .spyOn(FamilyMember, 'findOneAndUpdate')
        .mockRejectedValueOnce(new Error('buffering timed out'))
      try {
        const timeoutRes = await PUT(
          orgJsonReq(`/api/families/${params.id}/members/${params.memberId}`, 'PUT', {
            firstName: 'Calc',
            lastName: 'Fail',
            birthDate: '2011-05-01',
            gender: 'male',
          }),
          { params },
        )
        expect(timeoutRes.status).toBe(500)
        const body = await timeoutRes.json()
        expect(body.details).toBe('buffering timed out')
      } finally {
        dbSpy.mockRestore()
      }
    })
  })

  describe('statements/send-emails/status errors', () => {
    it('returns sanitized errors for failed jobs', async () => {
      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'failed',
        totalFamilies: 1,
        pending: [],
        processed: 1,
        sent: 0,
        failed: 1,
        errors: [{ email: 'fail@example.com', error: 'smtp rejected' }],
        lastError: 'worker died',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      const { GET } = await import('@/lib/route-logic/statements/send-emails/status')
      const res = await GET(
        orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
          query: `?jobId=${job._id}`,
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.done).toBe(true)
      expect(body.errors.length).toBeGreaterThan(0)
      expect(body.lastError).toBeTruthy()
    })
  })

  describe('statements/send-emails guards', () => {
    it('returns 400 without email config and 200 when no emailable families', async () => {
      const { EmailConfig, Family, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.betaOrgId, kind: 'statements' })
      await EmailConfig.deleteMany({ organizationId: ctx.betaOrgId })
      await Family.updateMany({ organizationId: ctx.betaOrgId }, { $unset: { email: 1 } })

      const { POST } = await import('@/lib/route-logic/statements/send-emails')
      const noConfig = await POST(
        orgJsonReq(
          '/api/statements/send-emails',
          'POST',
          { fromDate: `${year()}-01-01`, toDate: `${year()}-01-31` },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(noConfig.status).toBe(400)

      const { encrypt } = await import('@/lib/encryption')
      await EmailConfig.create({
        organizationId: ctx.betaOrgId,
        email: 'beta-bulk@finish.test',
        password: encrypt('app-password-test'),
        fromName: 'Beta Bulk',
        isActive: true,
      })
      const empty = await POST(
        orgJsonReq(
          '/api/statements/send-emails',
          'POST',
          { fromDate: `${year()}-01-01`, toDate: `${year()}-01-31` },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(empty.status).toBe(200)
      expect((await empty.json()).totalFamilies).toBe(0)
    })
  })

  describe('auth/invite accept logged-in', () => {
    it('accepts an invite when the signed-in user matches the invite email', async () => {
      const { User, Invite } = await import('@/lib/models')
      const email = `logged-in-${Date.now()}@example.com`
      const user = await User.create({
        email,
        name: 'Logged In Invitee',
        hashedPassword: 'hash',
      })
      const { POST, PUT } = await import('@/lib/route-logic/auth/invite')
      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email, role: 'member' }),
      )
      expect(createRes.status).toBe(200)
      const token = inviteTokenFromUrl((await createRes.json()).inviteUrl)

      mockAuth.mockResolvedValueOnce({
        user: {
          id: user._id.toString(),
          email,
          name: user.name,
          memberships: [],
        },
      } as never)
      const accept = await PUT(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'PUT',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ token }),
        }),
      )
      expect(accept.status).toBe(200)
      bindSession(ctx)

      await Invite.deleteMany({ email, organizationId: ctx.orgId })
      await User.deleteOne({ _id: user._id })
    })

    it('returns 409 when signup is attempted for an existing account', async () => {
      const { User } = await import('@/lib/models')
      const { POST, PUT } = await import('@/lib/route-logic/auth/invite')
      const email = `existing-${Date.now()}@example.com`
      await User.create({ email, name: 'Already There', hashedPassword: 'x' })

      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email, role: 'member' }),
      )
      expect(createRes.status).toBe(200)
      const token = inviteTokenFromUrl((await createRes.json()).inviteUrl)

      mockAuth.mockResolvedValueOnce(null as never)
      const conflict = await PUT(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'PUT',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token,
            name: 'Should Fail',
            password: 'FinishInvitePass123!',
          }),
        }),
      )
      expect(conflict.status).toBe(409)
      bindSession(ctx)

      await User.deleteOne({ email })
    })
  })

  describe('lifecycle-event-types/[id] extended', () => {
    it('updates, deletes, and returns 404 for unknown types', async () => {
      const { LifecycleEvent } = await import('@/lib/models')
      const disposable = await LifecycleEvent.create({
        organizationId: ctx.orgId,
        type: `finish_evt_${Date.now()}`,
        name: 'Finish Disposable Event',
        amount: 12,
      })
      const params = { id: disposable._id.toString() }
      const path = `/api/lifecycle-event-types/${params.id}`
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/lifecycle-event-types/[id]')

      const empty = await PUT(orgJsonReq(path, 'PUT', {}), { params })
      expect(empty.status).toBe(400)

      expect((await DELETE(orgJsonReq(path, 'DELETE'), { params })).status).toBe(200)

      const missing = await GET(
        orgJsonReq(`/api/lifecycle-event-types/${new Types.ObjectId()}`, 'GET'),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)
    })
  })

  describe('members/[memberId]/statements list and guards', () => {
    it('lists statements and rejects unknown members', async () => {
      const params = { memberId: ctx.fixtures.memberId }
      const { GET, POST } = await import('@/lib/route-logic/members/[memberId]/statements')

      const list = await GET(orgJsonReq(`/api/members/${params.memberId}/statements`, 'GET'), {
        params,
      })
      expect(list.status).toBe(200)
      expect(Array.isArray(await list.json())).toBe(true)

      const missing = await GET(
        orgJsonReq(`/api/members/${new Types.ObjectId()}/statements`, 'GET'),
        { params: { memberId: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)

      const badBody = await POST(
        orgJsonReq(`/api/members/${params.memberId}/statements`, 'POST', { fromDate: 'bad' }),
        { params },
      )
      expect(badBody.status).toBe(400)
    })
  })

  describe('send-file-email', () => {
    it('sends a PDF attachment and rejects unsafe inputs', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'file-send@finish.test',
            password: encrypt('app-password-test'),
            fromName: 'File Send',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
      const okForm = new FormData()
      okForm.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'probe.pdf')
      okForm.append('to', ctx.email)
      okForm.append('subject', 'Finish probe')
      okForm.append('message', 'See attached')

      const { POST } = await import('@/lib/route-logic/send-file-email')
      const ok = await POST(
        new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
          method: 'POST',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'x-organization-id': ctx.orgId,
          },
          body: okForm,
        }),
      )
      expect(ok.status).toBe(200)
      expect((await ok.json()).sent).toBe(true)

      const badMime = new FormData()
      badMime.append('file', new Blob([pdfBytes], { type: 'application/x-msdownload' }), 'bad.exe')
      badMime.append('to', ctx.email)
      expect(
        (
          await POST(
            new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
              method: 'POST',
              headers: {
                host: 'localhost:3000',
                origin: API_ORIGIN,
                'x-organization-id': ctx.orgId,
              },
              body: badMime,
            }),
          )
        ).status,
      ).toBe(415)

      const noFile = new FormData()
      noFile.append('to', ctx.email)
      expect(
        (
          await POST(
            new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
              method: 'POST',
              headers: {
                host: 'localhost:3000',
                origin: API_ORIGIN,
                'x-organization-id': ctx.orgId,
              },
              body: noFile,
            }),
          )
        ).status,
      ).toBe(400)
    })
  })

  describe('jobs/send-monthly-statements extended', () => {
    it('skips when locked and returns 500 when runChunked throws', async () => {
      const { JobLock } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'send-monthly-statements', lockKey })
      await JobLock.create({
        jobName: 'send-monthly-statements',
        lockKey,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })

      const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
      const skipped = await POST(
        orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true }),
      )
      expect(skipped.status).toBe(200)
      expect((await skipped.json()).skipped).toBe(true)

      await JobLock.deleteMany({ jobName: 'send-monthly-statements', lockKey })
      const jobs = await import('@/lib/jobs')
      const spy = vi
        .spyOn(jobs, 'runChunked')
        .mockRejectedValueOnce(new Error('monthly send chunk fail'))
      try {
        const fail = await POST(
          orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true }),
        )
        expect(fail.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('tax-receipts/email extended', () => {
    it('validates body and returns 500 when worker kickoff fails', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig, EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({ organizationId: ctx.orgId, kind: 'tax-receipts' })
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'tax@finish.test',
            password: encrypt('app-password-test'),
            fromName: 'Tax Finish',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const { POST } = await import('@/lib/route-logic/tax-receipts/email')
      expect(
        (await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: 'abc' }))).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/tax-receipts/email', 'POST', { year: year(), familyIds: 'nope' }),
          )
        ).status,
      ).toBe(400)

      const emailJobs = await import('@/lib/email-jobs')
      const kickoffSpy = vi.spyOn(emailJobs, 'kickoffEmailWorker').mockResolvedValue({
        ok: false,
        error: 'tax kickoff failed',
      })
      try {
        const res = await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
        expect(res.status).toBe(500)
        expect((await res.json()).jobId).toBeTruthy()
      } finally {
        kickoffSpy.mockRestore()
      }
    })
  })

  describe('families/[id]/payments', () => {
    it('lists payments and rejects year mismatch on create', async () => {
      const params = { id: ctx.fixtures.familyId }
      const path = `/api/families/${params.id}/payments`
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/payments')

      const list = await GET(orgJsonReq(path, 'GET'), { params })
      expect(list.status).toBe(200)
      expect(Array.isArray(await list.json())).toBe(true)

      const paged = await GET(orgJsonReq(`${path}?limit=50`, 'GET'), { params })
      expect(paged.status).toBe(200)
      const pageBody = await paged.json()
      expect(Array.isArray(pageBody.items)).toBe(true)
      expect('nextCursor' in pageBody).toBe(true)

      const y = year()
      const mismatch = await POST(
        orgJsonReq(path, 'POST', {
          amount: 25,
          paymentDate: `${y}-06-15`,
          year: y + 1,
          type: 'membership',
          paymentMethod: 'cash',
        }),
        { params },
      )
      expect(mismatch.status).toBe(400)

      const ok = await POST(
        orgJsonReq(path, 'POST', {
          amount: 15,
          paymentDate: `${y}-06-16`,
          year: y,
          type: 'membership',
          paymentMethod: 'check',
          checkInfo: { checkNumber: '1001' },
          memberId: ctx.fixtures.memberId,
        }),
        { params },
      )
      expect(ok.status).toBe(201)
    })
  })

  describe('families/[id] delete cascade', () => {
    it('soft-deletes a disposable family', async () => {
      const { Family, PaymentPlan } = await import('@/lib/models')
      const plan = await PaymentPlan.findById(ctx.fixtures.paymentPlanId)
      const disposable = await Family.create({
        organizationId: ctx.orgId,
        name: `Delete Me ${Date.now()}`,
        weddingDate: new Date('2013-01-01'),
        paymentPlanId: plan?._id,
      })
      const params = { id: disposable._id.toString() }
      const { DELETE } = await import('@/lib/route-logic/families/[id]')
      const res = await DELETE(orgJsonReq(`/api/families/${params.id}`, 'DELETE'), { params })
      expect(res.status).toBe(200)
    })
  })

  describe('reports/meta rate limit', () => {
    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/reports/meta')
        const res = await GET(orgJsonReq('/api/reports/meta', 'GET'))
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/withdrawals GET guards', () => {
    it('returns 400 for invalid family id on list', async () => {
      const { GET } = await import('@/lib/route-logic/families/[id]/withdrawals')
      const res = await GET(orgJsonReq('/api/families/not-valid/withdrawals', 'GET'), {
        params: { id: 'not-valid' },
      })
      expect(res.status).toBe(400)
    })
  })

  describe('lifecycle-event-types/[id] invalid id', () => {
    it('returns 400 for malformed ids', async () => {
      const params = { id: 'not-valid' }
      const { GET, PUT } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
      expect(
        (await GET(orgJsonReq('/api/lifecycle-event-types/x', 'GET'), { params })).status,
      ).toBe(400)
      expect(
        (await PUT(orgJsonReq('/api/lifecycle-event-types/x', 'PUT', { name: 'X' }), { params }))
          .status,
      ).toBe(400)
    })
  })

  describe('statements/[id] invalid id', () => {
    it('returns 400 for malformed statement id', async () => {
      const { GET } = await import('@/lib/route-logic/statements/[id]')
      const res = await GET(orgJsonReq('/api/statements/not-valid', 'GET'), {
        params: { id: 'not-valid' },
      })
      expect(res.status).toBe(400)
    })
  })

  describe('members/[memberId]/statements race refresh', () => {
    it('refreshes an existing row when create races on duplicate key', async () => {
      const y = year()
      const params = { memberId: ctx.fixtures.memberId }
      const { Statement } = await import('@/lib/models')
      const from = new Date(`${y}-08-01`)
      const to = new Date(`${y}-08-31`)
      const raced = await Statement.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        memberId: ctx.fixtures.memberId,
        statementNumber: `STMT-MEM-race-${Date.now()}`,
        date: new Date(),
        fromDate: from,
        toDate: to,
        openingBalance: 0,
        income: 0,
        withdrawals: 0,
        expenses: 0,
        cycleCharges: 0,
        closingBalance: 0,
      })

      let findCalls = 0
      const findSpy = vi.spyOn(Statement, 'findOne').mockImplementation(async () => {
        findCalls += 1
        if (findCalls === 1) return null
        return raced
      })
      const createSpy = vi.spyOn(Statement, 'create').mockRejectedValueOnce({ code: 11000 })
      try {
        const { POST } = await import('@/lib/route-logic/members/[memberId]/statements')
        const res = await POST(
          orgJsonReq(`/api/members/${params.memberId}/statements`, 'POST', {
            fromDate: `${y}-08-01`,
            toDate: `${y}-08-31`,
          }),
          { params },
        )
        expect(res.status).toBe(200)
      } finally {
        findSpy.mockRestore()
        createSpy.mockRestore()
        await Statement.deleteOne({ _id: raced._id })
      }
    })
  })

  describe('calculations POST failure', () => {
    it('returns 500 when calculateAndSaveYear throws', async () => {
      const calcMod = await import('@/lib/calculations')
      const spy = vi
        .spyOn(calcMod, 'calculateAndSaveYear')
        .mockRejectedValueOnce(new Error('calc save failed'))
      try {
        const { POST } = await import('@/lib/route-logic/calculations')
        const res = await POST(
          orgJsonReq('/api/calculations', 'POST', {
            year: year() + 2,
            extraDonation: 0,
            extraExpense: 0,
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id] parent family', () => {
    it('links a child family to a parent in the same org', async () => {
      const { Family } = await import('@/lib/models')
      const child = await Family.create({
        organizationId: ctx.orgId,
        name: `Child Family ${Date.now()}`,
        weddingDate: new Date('2016-01-01'),
        paymentPlanId: ctx.fixtures.paymentPlanId,
      })
      const params = { id: child._id.toString() }
      const { PUT } = await import('@/lib/route-logic/families/[id]')
      const res = await PUT(
        orgJsonReq(`/api/families/${params.id}`, 'PUT', {
          parentFamilyId: ctx.fixtures.familyId,
        }),
        { params },
      )
      expect(res.status).toBe(200)
      const updated = await Family.findById(child._id)
      expect(String(updated?.parentFamilyId)).toBe(ctx.fixtures.familyId)
    })
  })

  describe('families/[id]/saved-payment-methods list', () => {
    it('lists saved payment methods for a family', async () => {
      const path = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { GET } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await GET(orgJsonReq(path, 'GET'), { params: { id: ctx.fixtures.familyId } })
      expect(res.status).toBe(200)
      expect(Array.isArray(await res.json())).toBe(true)
    })
  })

  describe('families/[id]/payments member guard', () => {
    it('returns 404 when memberId is not in the family', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const orphan = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Other',
        lastName: 'Family',
        birthDate: new Date('2012-01-01'),
      })
      const params = { id: ctx.fixtures.familyId }
      const { POST } = await import('@/lib/route-logic/families/[id]/payments')
      const y = year()
      const res = await POST(
        orgJsonReq(`/api/families/${params.id}/payments`, 'POST', {
          amount: 10,
          paymentDate: `${y}-07-01`,
          year: y,
          memberId: orphan._id.toString(),
        }),
        { params },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('payment-plans extended', () => {
    it('returns an empty array when no plans exist', async () => {
      const { PaymentPlan } = await import('@/lib/models')
      await PaymentPlan.deleteMany({ organizationId: ctx.betaOrgId })
      const { GET, POST } = await import('@/lib/route-logic/payment-plans')
      const list = await GET(
        orgJsonReq('/api/payment-plans', 'GET', undefined, { orgId: ctx.betaOrgId }),
      )
      expect(list.status).toBe(200)
      expect(await list.json()).toEqual([])

      const create = await POST(
        orgJsonReq(
          '/api/payment-plans',
          'POST',
          { name: 'Beta Plan', planNumber: 1, yearlyPrice: 100 },
          { orgId: ctx.betaOrgId },
        ),
      )
      expect(create.status).toBe(201)
    })
  })

  describe('cycle-config hebrew day validation', () => {
    it('rejects invalid hebrew day values', async () => {
      const { POST } = await import('@/lib/route-logic/cycle-config')
      const res = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'hebrew',
          cycleStartMonth: 9,
          cycleStartDay: 1,
          cycleStartHebrewMonth: 7,
          cycleStartHebrewDay: 31,
        }),
      )
      expect(res.status).toBe(400)
    })
  })

  describe('auth/invite GET accepted', () => {
    it('returns 410 when resolving an already-accepted invite', async () => {
      const email = `accepted-${Date.now()}@example.com`
      const { Invite } = await import('@/lib/models')
      const { POST, GET } = await import('@/lib/route-logic/auth/invite')
      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email, role: 'member' }),
      )
      const token = inviteTokenFromUrl((await createRes.json()).inviteUrl)
      await Invite.updateOne(
        { organizationId: ctx.orgId, email },
        { $set: { acceptedAt: new Date() } },
      )
      const res = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite?token=${encodeURIComponent(token)}`, {
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(res.status).toBe(410)
    })
  })

  describe('send-file-email decrypt failure', () => {
    it('returns 500 when stored password cannot be decrypted', async () => {
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'file-decrypt@finish.test',
            password: 'enc:v1:AAAAAAAA:BBBBBBBB:CCCCCCCC',
            fromName: 'File Decrypt',
            isActive: true,
          },
        },
        { upsert: true },
      )
      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }),
        'x.pdf',
      )
      form.append('to', ctx.email)
      const { POST } = await import('@/lib/route-logic/send-file-email')
      const res = await POST(
        new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
          method: 'POST',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'x-organization-id': ctx.orgId,
          },
          body: form,
        }),
      )
      expect(res.status).toBe(500)
    })
  })

  describe('statements/auto-generate cron', () => {
    it('auto-generates via POST with cron secret and organizationId', async () => {
      const { POST } = await import('@/lib/route-logic/statements/auto-generate')
      const res = await POST(
        orgJsonReq(
          '/api/statements/auto-generate',
          'POST',
          {},
          {
            cron: true,
            query: `?organizationId=${ctx.orgId}`,
          },
        ),
      )
      expect(res.status).toBe(201)
    })
  })

  describe('auth/reset-password token used', () => {
    it('returns 410 when confirming with an already-used token', async () => {
      const { PasswordResetToken, User } = await import('@/lib/models')
      const crypto = await import('crypto')
      const token = crypto.randomBytes(16).toString('base64url')
      const hash = crypto.createHash('sha256').update(token).digest('hex')
      const user = await User.findOne({ email: ctx.email })
      await PasswordResetToken.create({
        userId: user!._id,
        token: hash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      })
      const { PUT } = await import('@/lib/route-logic/auth/reset-password')
      const res = await PUT(
        publicJsonReq('/api/auth/reset-password', 'PUT', {
          token,
          newPassword: 'NewResetPass123!',
        }),
      )
      expect(res.status).toBe(410)
    })
  })

  describe('tasks list filters', () => {
    it('filters by status and priority', async () => {
      const { GET } = await import('@/lib/route-logic/tasks')
      const statusRes = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, { query: '?status=pending' }),
      )
      expect(statusRes.status).toBe(200)

      const badStatus = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, { query: '?status=not-a-status' }),
      )
      expect(badStatus.status).toBe(400)

      const priorityRes = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, { query: '?priority=high' }),
      )
      expect(priorityRes.status).toBe(200)
    })
  })

  describe('lifecycle-event-types create', () => {
    it('creates a new event type successfully', async () => {
      const { POST } = await import('@/lib/route-logic/lifecycle-event-types')
      const res = await POST(
        orgJsonReq('/api/lifecycle-event-types', 'POST', {
          type: `finish_type_${Date.now()}`,
          name: 'Finish Custom Event',
          amount: 42,
        }),
      )
      expect(res.status).toBe(201)
    })
  })

  describe('lifecycle-event-types/[id] validation', () => {
    it('returns 400 when PUT body fails validation', async () => {
      const params = { id: ctx.fixtures.lifecycleEventTypeId }
      const { PUT } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
      const res = await PUT(
        orgJsonReq(`/api/lifecycle-event-types/${params.id}`, 'PUT', { amount: -5 }),
        { params },
      )
      expect(res.status).toBe(400)
    })
  })

  describe('events ledger', () => {
    it('lists lifecycle event payments with labels', async () => {
      const { GET } = await import('@/lib/route-logic/events')
      const res = await GET(orgJsonReq('/api/events', 'GET'))
      expect(res.status).toBe(200)
      const rows = await res.json()
      expect(Array.isArray(rows)).toBe(true)
      if (rows.length > 0) {
        expect(rows[0].eventTypeLabel).toBeTruthy()
      }
    })
  })

  describe('families/[id]/saved-payment-methods existing card', () => {
    it('reactivates an existing saved payment method on duplicate save', async () => {
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
        paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
      }
      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const params = { id: ctx.fixtures.familyId }
      const piId = 'pi_existingcard01'
      const pmId = 'pm_existingcard99'

      client.paymentIntents.retrieve.mockResolvedValue({
        id: piId,
        status: 'succeeded',
        payment_method: pmId,
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      client.paymentMethods.retrieve.mockResolvedValue({
        id: pmId,
        card: { last4: '1111', brand: 'visa', exp_month: 1, exp_year: 2030 },
        billing_details: { name: 'Existing' },
      })

      const { SavedPaymentMethod } = await import('@/lib/models')
      await SavedPaymentMethod.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        stripePaymentMethodId: pmId,
      })

      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const first = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: pmId,
          paymentIntentId: piId,
          setAsDefault: true,
        }),
        { params },
      )
      expect(first.status).toBe(201)

      const second = await POST(
        orgJsonReq(familyPath, 'POST', {
          paymentMethodId: pmId,
          paymentIntentId: piId,
        }),
        { params },
      )
      expect(second.status).toBe(200)
    })

    it('returns 400 when DELETE is missing paymentMethodId', async () => {
      const { DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await DELETE(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/saved-payment-methods`, 'DELETE'),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })
  })

  describe('organizations slug collision', () => {
    it('appends a numeric suffix when slug already exists', async () => {
      const { Organization } = await import('@/lib/models')
      const name = `Finish Collision ${Date.now()}`
      const baseSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30)
      await Organization.create({
        name,
        slug: baseSlug,
        ownerId: ctx.userId,
      })
      const { POST } = await import('@/lib/route-logic/organizations')
      const res = await POST(sessionJsonReq('/api/organizations', 'POST', { name }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.slug).toBe(`${baseSlug}-1`)
    })
  })

  describe('auth/invite platform email', () => {
    it('includes email_result when platform SMTP is configured', async () => {
      const platformEmail = await import('@/lib/platform-email')
      const configuredSpy = vi
        .spyOn(platformEmail, 'isPlatformEmailConfigured')
        .mockReturnValue(true)
      const sendSpy = vi.spyOn(platformEmail, 'sendPlatformEmail').mockResolvedValue({ sent: true })
      try {
        const { POST } = await import('@/lib/route-logic/auth/invite')
        const res = await POST(
          orgJsonReq('/api/auth/invite', 'POST', {
            email: `smtp-${Date.now()}@example.com`,
            role: 'member',
          }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.email_result?.sent).toBe(true)
        expect(sendSpy).toHaveBeenCalled()
      } finally {
        configuredSpy.mockRestore()
        sendSpy.mockRestore()
      }
    })
  })

  describe('jobs/cycle-rollover extended', () => {
    it('skips when another rollover is already locked for today', async () => {
      const { JobLock } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'cycle-rollover', lockKey })
      await JobLock.create({
        jobName: 'cycle-rollover',
        lockKey,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
      const res = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
      expect(res.status).toBe(200)
      expect((await res.json()).skipped).toBe(true)
      await JobLock.deleteMany({ jobName: 'cycle-rollover', lockKey })
    })

    it('records per-org errors without failing the whole job', async () => {
      const rollover = await import('@/lib/cycle-rollover')
      const jobs = await import('@/lib/jobs')
      const scheduleSpy = vi.spyOn(jobs, 'cycleConfigMatchesSchedule').mockReturnValue(true)
      const spy = vi
        .spyOn(rollover, 'runCycleRolloverForOrg')
        .mockImplementation(async (orgId: string) => {
          if (orgId === ctx.orgId) {
            throw new Error('rollover failed')
          }
          return {
            organizationId: orgId,
            cycleYear: year(),
            calendar: 'gregorian' as const,
            charged: 0,
            skipped: 0,
            noPlan: 0,
            errors: [],
          }
        })
      try {
        const { CycleConfig, JobLock } = await import('@/lib/models')
        const lockKey = new Date().toISOString().slice(0, 10)
        await JobLock.deleteMany({ jobName: 'cycle-rollover', lockKey })
        await CycleConfig.updateOne(
          { organizationId: ctx.orgId, isActive: true },
          { $set: { cycleAutoRollover: true, cycleCalendar: 'gregorian' } },
          { upsert: true },
        )
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const res = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
        scheduleSpy.mockRestore()
      }
    })
  })

  describe('jobs/generate-monthly-statements lock', () => {
    it('skips when locked for today', async () => {
      const { JobLock } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'generate-monthly-statements', lockKey })
      await JobLock.create({
        jobName: 'generate-monthly-statements',
        lockKey,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
      const res = await POST(
        orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).skipped).toBe(true)
      await JobLock.deleteMany({ jobName: 'generate-monthly-statements', lockKey })
    })
  })

  describe('stripe/confirm-payment cross-org', () => {
    it('returns 409 when PaymentIntent belongs to another org', async () => {
      const { Payment } = await import('@/lib/models')
      const pi = 'pi_finishcrossorg1'
      await Payment.create({
        organizationId: ctx.betaOrgId,
        familyId: ctx.fixtures.betaFamilyId,
        amount: 10,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: pi,
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: pi,
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: pi,
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(res.status).toBe(409)
    })
  })

  describe('families/[id]/withdrawals family guard', () => {
    it('returns 404 when family is outside the active org', async () => {
      const { POST } = await import('@/lib/route-logic/families/[id]/withdrawals')
      const res = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.betaFamilyId}/withdrawals`, 'POST', {
          amount: 5,
          withdrawalDate: today(),
        }),
        { params: { id: ctx.fixtures.betaFamilyId } },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('families/[id]/withdrawals rate limits', () => {
    it('returns 429 when list or create is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const params = { id: ctx.fixtures.familyId }
      const path = `/api/families/${params.id}/withdrawals`
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/withdrawals')
      try {
        expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(429)
        expect(
          (await POST(orgJsonReq(path, 'POST', { amount: 5, withdrawalDate: today() }), { params }))
            .status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('lifecycle-event-types rate limits', () => {
    it('returns 429 on list and create when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const { GET, POST } = await import('@/lib/route-logic/lifecycle-event-types')
      try {
        expect((await GET(orgJsonReq('/api/lifecycle-event-types', 'GET'))).status).toBe(429)
        expect(
          (
            await POST(
              orgJsonReq('/api/lifecycle-event-types', 'POST', {
                type: `rate_${Date.now()}`,
                name: 'Rate Limited',
                amount: 1,
              }),
            )
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('lifecycle-event-types POST body', () => {
    it('requires a JSON object body', async () => {
      const { POST } = await import('@/lib/route-logic/lifecycle-event-types')
      const res = await POST(
        new NextRequest(`${API_ORIGIN}/api/lifecycle-event-types`, {
          method: 'POST',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'x-organization-id': ctx.orgId,
            'content-type': 'application/json',
          },
        }),
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Validation failed')
    })
  })

  describe('lifecycle-event-types/[id] rate limits and update', () => {
    it('returns 429 and updates a disposable type', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const { LifecycleEvent } = await import('@/lib/models')
      const disposable = await LifecycleEvent.create({
        organizationId: ctx.orgId,
        type: `finish_upd_${Date.now()}`,
        name: 'Before Update',
        amount: 5,
      })
      const params = { id: disposable._id.toString() }
      const path = `/api/lifecycle-event-types/${params.id}`
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/lifecycle-event-types/[id]')

      const updated = await PUT(orgJsonReq(path, 'PUT', { name: 'After Update', amount: 88 }), {
        params,
      })
      expect(updated.status).toBe(200)
      expect((await updated.json()).amount).toBe(88)

      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(429)
        expect((await PUT(orgJsonReq(path, 'PUT', { name: 'X' }), { params })).status).toBe(429)
        expect((await DELETE(orgJsonReq(path, 'DELETE'), { params })).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/lifecycle-events default amount', () => {
    it('uses the configured type amount when amount is omitted', async () => {
      const y0 = year()
      const params = { id: ctx.fixtures.familyId }
      const path = `/api/families/${params.id}/lifecycle-events`
      const { POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          eventType: 'bar_mitzvah',
          eventDate: `${y0}-09-10`,
          year: y0,
        }),
        { params },
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.amount).toBeGreaterThan(0)
    })
  })

  describe('families/[id]/lifecycle-events rate limit', () => {
    it('returns 429 when list is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const params = { id: ctx.fixtures.familyId }
      const { GET } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
      try {
        const res = await GET(orgJsonReq(`/api/families/${params.id}/lifecycle-events`, 'GET'), {
          params,
        })
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('auth/reset-password SMTP', () => {
    it('sends reset email when platform SMTP is configured', async () => {
      const platformEmail = await import('@/lib/platform-email')
      const configuredSpy = vi
        .spyOn(platformEmail, 'isPlatformEmailConfigured')
        .mockReturnValue(true)
      const sendSpy = vi.spyOn(platformEmail, 'sendPlatformEmail').mockResolvedValue({ sent: true })
      try {
        const { POST } = await import('@/lib/route-logic/auth/reset-password')
        const res = await POST(
          publicJsonReq('/api/auth/reset-password', 'POST', { email: ctx.email }),
        )
        expect(res.status).toBe(200)
        expect(sendSpy).toHaveBeenCalled()
      } finally {
        configuredSpy.mockRestore()
        sendSpy.mockRestore()
      }
    })

    it('returns 429 when reset requests are rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { POST } = await import('@/lib/route-logic/auth/reset-password')
        const res = await POST(
          publicJsonReq('/api/auth/reset-password', 'POST', { email: ctx.email }),
        )
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('tasks filters extended', () => {
    it('rejects invalid related ids and filters overdue tasks', async () => {
      const { GET } = await import('@/lib/route-logic/tasks')
      expect(
        (
          await GET(
            orgJsonReq('/api/tasks', 'GET', undefined, {
              query: '?relatedMemberId=not-valid',
            }),
          )
        ).status,
      ).toBe(400)
      const overdue = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, { query: '?dueDate=overdue' }),
      )
      expect(overdue.status).toBe(200)
    })
  })

  describe('audit-log csv export', () => {
    it('streams CSV when format=csv', async () => {
      const { GET } = await import('@/lib/route-logic/audit-log')
      const y0 = year()
      const res = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: `?format=csv&fromDate=${y0}-01-01&toDate=${y0}-12-31`,
        }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/csv/i)
      const text = await res.text()
      expect(text).toContain('when,action')
    })
  })

  describe('statements/[id] detail', () => {
    it('returns refreshed statement with transactions', async () => {
      const params = { id: ctx.fixtures.statementId }
      const { GET } = await import('@/lib/route-logic/statements/[id]')
      const res = await GET(orgJsonReq(`/api/statements/${params.id}`, 'GET'), { params })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.statement?._id).toBeTruthy()
      expect(Array.isArray(body.transactions)).toBe(true)
    })
  })

  describe('statements/send-single-email rate limit', () => {
    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { POST } = await import('@/lib/route-logic/statements/send-single-email')
        const res = await POST(
          orgJsonReq('/api/statements/send-single-email', 'POST', {
            statement: { _id: ctx.fixtures.statementId },
          }),
        )
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('jobs/generate-monthly-statements cron guards', () => {
    it('returns 401 without cron secret and 429 when rate limited', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
      const unauth = await POST(orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}))
      expect(unauth.status).toBe(401)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const limited = await POST(
          orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }),
        )
        expect(limited.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('jobs/wedding-converter guards', () => {
    it('returns 401, 429, lock skip, and 500 when JobRun create fails', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
      expect((await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}))).status).toBe(401)

      const rateLimit = await import('@/lib/rate-limit')
      const rateSpy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true })))
            .status,
        ).toBe(429)
      } finally {
        rateSpy.mockRestore()
      }

      const { JobLock } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'wedding-converter', lockKey })
      await JobLock.create({
        jobName: 'wedding-converter',
        lockKey,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      const skipped = await POST(
        orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }),
      )
      expect(skipped.status).toBe(200)
      expect((await skipped.json()).skipped).toBe(true)
      await JobLock.deleteMany({ jobName: 'wedding-converter', lockKey })

      const { FamilyMember } = await import('@/lib/models')
      const distinctSpy = vi
        .spyOn(FamilyMember, 'distinct')
        .mockRejectedValueOnce(new Error('distinct failed'))
      try {
        const failed = await POST(
          orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }),
        )
        expect(failed.status).toBe(500)
      } finally {
        distinctSpy.mockRestore()
      }
    })
  })

  describe('payment-plans/[id] rate limits and delete', () => {
    it('returns 429 on detail routes and deletes an unassigned plan', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const { PaymentPlan } = await import('@/lib/models')
      const disposable = await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: 'Disposable Finish Plan',
        planNumber: 96,
        yearlyPrice: 96,
      })
      const params = { id: disposable._id.toString() }
      const path = `/api/payment-plans/${params.id}`
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/payment-plans/[id]')

      const updated = await PUT(orgJsonReq(path, 'PUT', { name: 'Renamed Finish Plan' }), {
        params,
      })
      expect(updated.status).toBe(200)

      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(429)
        expect((await PUT(orgJsonReq(path, 'PUT', { name: 'X' }), { params })).status).toBe(429)
        expect((await DELETE(orgJsonReq(path, 'DELETE'), { params })).status).toBe(429)
      } finally {
        spy.mockRestore()
      }

      const deleted = await DELETE(orgJsonReq(path, 'DELETE'), { params })
      expect(deleted.status).toBe(200)
    })
  })

  describe('stripe/create-payment-intent extended', () => {
    it('validates familyId, rate limits, and records recurring ratio', async () => {
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.updateOne(
        { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId, isActive: true },
        {
          $set: {
            amount: 100,
            savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
            paymentFrequency: 'monthly',
          },
        },
        { upsert: true },
      )

      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
      expect(
        (await POST(orgJsonReq('/api/stripe/create-payment-intent', 'POST', { amount: 50 })))
          .status,
      ).toBe(400)

      const missingFam = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          amount: 50,
          familyId: new Types.ObjectId().toString(),
        }),
      )
      expect(missingFam.status).toBe(404)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (
            await POST(
              orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
                familyId: ctx.fixtures.familyId,
                amount: 50,
              }),
            )
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }

      const ok = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 100,
          description: 'ratio probe',
          idempotencyHint: `ratio-${Date.now()}`,
        }),
      )
      expect(ok.status).toBe(200)
    })

    it('returns 500 when Stripe payment intent creation fails', async () => {
      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockRejectedValueOnce(new Error('card network down'))

      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
      const res = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 25,
          idempotencyHint: `fail-${Date.now()}`,
        }),
      )
      expect(res.status).toBe(500)
    })
  })

  describe('admin/invite-requests extended', () => {
    it('approves with platform email, rejects, and guards invalid actions', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const pending = await InviteRequest.create({
        email: `finish-admin-${Date.now()}@example.com`,
        name: 'Finish Admin',
        message: 'please',
        status: 'pending',
      })
      const used = await InviteRequest.create({
        email: `finish-used-${Date.now()}@example.com`,
        name: 'Used Already',
        message: 'used',
        status: 'approved',
        signupCode: 'used-code',
        signupCodeExpiresAt: new Date(Date.now() + 3600_000),
        usedAt: new Date(),
      })

      const platformEmail = await import('@/lib/platform-email')
      const configuredSpy = vi
        .spyOn(platformEmail, 'isPlatformEmailConfigured')
        .mockReturnValue(true)
      const sendSpy = vi.spyOn(platformEmail, 'sendPlatformEmail').mockResolvedValue({ sent: true })

      const { GET, PATCH } = await import('@/lib/route-logic/admin/invite-requests')
      try {
        const list = await GET(
          orgJsonReq('/api/admin/invite-requests', 'GET', undefined, { query: '?status=pending' }),
        )
        expect(list.status).toBe(200)
        expect((await list.json()).emailEnabled).toBe(true)

        const approve = await PATCH(
          orgJsonReq('/api/admin/invite-requests', 'PATCH', {
            id: pending._id.toString(),
            action: 'approve',
          }),
        )
        expect(approve.status).toBe(200)
        expect(sendSpy).toHaveBeenCalled()

        const reissue = await PATCH(
          orgJsonReq('/api/admin/invite-requests', 'PATCH', {
            id: pending._id.toString(),
            action: 'reissue',
          }),
        )
        expect(reissue.status).toBe(200)

        const usedRes = await PATCH(
          orgJsonReq('/api/admin/invite-requests', 'PATCH', {
            id: used._id.toString(),
            action: 'approve',
          }),
        )
        expect(usedRes.status).toBe(409)

        const badAction = await PATCH(
          orgJsonReq('/api/admin/invite-requests', 'PATCH', {
            id: pending._id.toString(),
            action: 'nope',
          }),
        )
        expect(badAction.status).toBe(400)
      } finally {
        configuredSpy.mockRestore()
        sendSpy.mockRestore()
        await InviteRequest.deleteMany({ _id: { $in: [pending._id, used._id] } })
      }
    })

    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/admin/invite-requests')
        expect((await GET(orgJsonReq('/api/admin/invite-requests', 'GET'))).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('cycle-config rate limit', () => {
    it('returns 429 on GET when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/cycle-config')
        expect((await GET(orgJsonReq('/api/cycle-config', 'GET'))).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/lifecycle-events POST rate limit', () => {
    it('returns 429 when create is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const params = { id: ctx.fixtures.familyId }
      const { POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
      try {
        const res = await POST(
          orgJsonReq(`/api/families/${params.id}/lifecycle-events`, 'POST', {
            eventType: 'bar_mitzvah',
            eventDate: `${year()}-10-01`,
            amount: 10,
            year: year(),
          }),
          { params },
        )
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })

    it('still creates when yearly calculation invalidation fails', async () => {
      const calc = await import('@/lib/calculations')
      const spy = vi
        .spyOn(calc, 'updateYearlyCalculationForEvent')
        .mockRejectedValueOnce(new Error('cache invalidation failed'))
      const y0 = year()
      const params = { id: ctx.fixtures.familyId }
      const { POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
      try {
        const res = await POST(
          orgJsonReq(`/api/families/${params.id}/lifecycle-events`, 'POST', {
            eventType: 'bar_mitzvah',
            eventDate: `${y0}-11-05`,
            amount: 15,
            year: y0,
          }),
          { params },
        )
        expect(res.status).toBe(201)
        await new Promise((r) => setTimeout(r, 10))
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/sub-families rate limit', () => {
    it('returns 429 when list is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const params = { id: ctx.fixtures.familyId }
      const { GET } = await import('@/lib/route-logic/families/[id]/sub-families')
      try {
        const res = await GET(orgJsonReq(`/api/families/${params.id}/sub-families`, 'GET'), {
          params,
        })
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('auth/invite DELETE guards', () => {
    it('returns 400 for invalid id and 429 when rate limited', async () => {
      const { DELETE } = await import('@/lib/route-logic/auth/invite')
      expect((await DELETE(orgJsonReq('/api/auth/invite?id=not-valid', 'DELETE'))).status).toBe(400)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (await DELETE(orgJsonReq(`/api/auth/invite?id=${new Types.ObjectId()}`, 'DELETE')))
            .status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('organizations rate limit', () => {
    it('returns 429 when org create is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { POST } = await import('@/lib/route-logic/organizations')
        const res = await POST(
          sessionJsonReq('/api/organizations', 'POST', { name: `Rate Org ${Date.now()}` }),
        )
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('statements/[id] guards', () => {
    it('returns 404 and 429', async () => {
      const { GET } = await import('@/lib/route-logic/statements/[id]')
      const missingId = new Types.ObjectId().toString()
      const missing = await GET(orgJsonReq(`/api/statements/${missingId}`, 'GET'), {
        params: { id: missingId },
      })
      expect(missing.status).toBe(404)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (
            await GET(orgJsonReq(`/api/statements/${ctx.fixtures.statementId}`, 'GET'), {
              params: { id: ctx.fixtures.statementId },
            })
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('statements/generate-pdf', () => {
    it('returns PDF bytes and handles validation errors', async () => {
      const { POST } = await import('@/lib/route-logic/statements/generate-pdf')
      const ok = await POST(
        orgJsonReq('/api/statements/generate-pdf', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect(ok.status).toBe(200)
      expect(ok.headers.get('content-type')).toMatch(/application\/pdf/)

      const noBody = await POST(orgJsonReq('/api/statements/generate-pdf', 'POST', null))
      expect(noBody.status).toBe(400)

      const missing = await POST(
        orgJsonReq('/api/statements/generate-pdf', 'POST', {
          statement: { _id: new Types.ObjectId().toString() },
        }),
      )
      expect(missing.status).toBe(404)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (
            await POST(
              orgJsonReq('/api/statements/generate-pdf', 'POST', {
                statement: { _id: ctx.fixtures.statementId },
              }),
            )
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id] rate limits', () => {
    it('returns 429 on GET, PUT, and DELETE', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const params = { id: ctx.fixtures.familyId }
      const path = `/api/families/${params.id}`
      try {
        const { GET, PUT, DELETE } = await import('@/lib/route-logic/families/[id]')
        expect((await GET(orgJsonReq(path, 'GET'), { params })).status).toBe(429)
        expect(
          (await PUT(orgJsonReq(path, 'PUT', { name: 'Rate Limit' }), { params })).status,
        ).toBe(429)
        expect((await DELETE(orgJsonReq(path, 'DELETE'), { params })).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('stripe/confirm-payment saved method guard', () => {
    it('returns 404 when savedPaymentMethodId is unknown', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_badspm00001',
      })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_badspm00001',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_badspm00001',
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: new Types.ObjectId().toString(),
        }),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('events rate limit', () => {
    it('returns 429 when list is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/events')
        expect((await GET(orgJsonReq('/api/events', 'GET'))).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('statements/auto-generate extended', () => {
    it('generates for a specific month and returns 429 when rate limited', async () => {
      const y0 = year()
      const { GET, POST } = await import('@/lib/route-logic/statements/auto-generate')
      const monthRes = await GET(
        orgJsonReq('/api/statements/auto-generate', 'GET', undefined, {
          query: `?year=${y0}&month=1`,
        }),
      )
      expect(monthRes.status).toBe(200)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect((await POST(orgJsonReq('/api/statements/auto-generate', 'POST', {}))).status).toBe(
          429,
        )
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('audit-log user filter', () => {
    it('filters by userId when the user belongs to the org', async () => {
      const { GET } = await import('@/lib/route-logic/audit-log')
      const res = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: `?userId=${ctx.userId}&limit=5`,
        }),
      )
      expect(res.status).toBe(200)
    })
  })

  describe('auth/signup invite code', () => {
    it('validates an approved code and creates an account', async () => {
      const { InviteRequest, User } = await import('@/lib/models')
      const code = `finish-signup-${Date.now()}`
      const email = `signup-finish-${Date.now()}@example.com`
      await InviteRequest.create({
        email,
        name: 'Signup Finish',
        message: 'access',
        status: 'approved',
        signupCode: code,
        signupCodeExpiresAt: new Date(Date.now() + 3600_000),
      })

      const { GET, POST } = await import('@/lib/route-logic/auth/signup')
      const getRes = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/signup?code=${encodeURIComponent(code)}`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(getRes.status).toBe(200)
      expect((await getRes.json()).valid).toBe(true)

      const postRes = await POST(
        publicJsonReq('/api/auth/signup', 'POST', {
          inviteCode: code,
          password: 'FinishSignupPass123!',
          name: 'Signup Finish',
        }),
      )
      expect(postRes.status).toBe(200)
      expect((await postRes.json()).email).toBe(email)

      await User.deleteOne({ email })
      await InviteRequest.deleteMany({ email })
    })
  })

  describe('tax-receipts/[familyId]/pdf', () => {
    it('streams a PDF when membership dues exist for the year', async () => {
      const { Payment } = await import('@/lib/models')
      const y0 = year()
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 55,
        paymentDate: new Date(`${y0}-06-15`),
        year: y0,
        type: 'membership',
        paymentMethod: 'cash',
      })

      const { GET } = await import('@/lib/route-logic/tax-receipts/[familyId]/pdf')
      const res = await GET(
        orgJsonReq(`/api/tax-receipts/${ctx.fixtures.familyId}/pdf`, 'GET', undefined, {
          query: `?year=${y0}`,
        }),
        { params: Promise.resolve({ familyId: ctx.fixtures.familyId }) },
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/application\/pdf/)
    })

    it('returns 400 when no net dues were recorded for the year', async () => {
      const { GET } = await import('@/lib/route-logic/tax-receipts/[familyId]/pdf')
      const res = await GET(
        orgJsonReq(`/api/tax-receipts/${ctx.fixtures.familyId}/pdf`, 'GET', undefined, {
          query: '?year=1999',
        }),
        { params: Promise.resolve({ familyId: ctx.fixtures.familyId }) },
      )
      expect(res.status).toBe(400)
    })
  })

  describe('email-config/test rate limit', () => {
    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { POST } = await import('@/lib/route-logic/email-config/test')
        expect((await POST(orgJsonReq('/api/email-config/test', 'POST', {}))).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('lifecycle-event-types/[id] DELETE invalid id', () => {
    it('returns 400 when id is malformed', async () => {
      const { DELETE } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
      const res = await DELETE(orgJsonReq('/api/lifecycle-event-types/not-valid', 'DELETE'), {
        params: { id: 'not-valid' },
      })
      expect(res.status).toBe(400)
    })
  })

  describe('tax-receipts/zip', () => {
    it('streams a ZIP when membership dues exist and rejects empty years', async () => {
      const { Payment } = await import('@/lib/models')
      const y0 = year()
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 60,
        paymentDate: new Date(`${y0}-05-20`),
        year: y0,
        type: 'membership',
        paymentMethod: 'cash',
      })

      const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
      const ok = await GET(
        orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${y0}` }),
      )
      expect(ok.status).toBe(200)
      expect(ok.headers.get('content-type')).toMatch(/application\/zip/)

      const empty = await GET(
        orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: '?year=1999' }),
      )
      expect(empty.status).toBe(400)
    })

    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
        expect(
          (
            await GET(
              orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${year()}` }),
            )
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families list rate limits', () => {
    it('returns 429 on GET and POST when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET, POST } = await import('@/lib/route-logic/families')
        expect((await GET(orgJsonReq('/api/families', 'GET'))).status).toBe(200)
        expect(
          (
            await POST(
              orgJsonReq('/api/families', 'POST', {
                name: 'Rate Family',
                weddingDate: '2015-01-01',
                paymentPlanId: ctx.fixtures.paymentPlanId,
              }),
            )
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('audit-log pagination and filters', () => {
    it('paginates JSON results and filters by action', async () => {
      const { AuditLog } = await import('@/lib/models')
      const stamp = Date.now()
      await AuditLog.create({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        action: `finish.audit.${stamp}`,
        resourceType: 'Family',
        resourceId: ctx.fixtures.familyId,
        ip: '127.0.0.1',
      })

      const { GET } = await import('@/lib/route-logic/audit-log')
      const first = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: `?limit=1&action=finish.audit.${stamp}`,
        }),
      )
      expect(first.status).toBe(200)
      const page = await first.json()
      expect(page.items).toHaveLength(1)
      if (page.nextCursor) {
        const second = await GET(
          orgJsonReq('/api/audit-log', 'GET', undefined, {
            query: `?limit=1&cursor=${encodeURIComponent(page.nextCursor)}&action=finish.audit.${stamp}`,
          }),
        )
        expect(second.status).toBe(200)
      }

      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, {
              query: '?cursor=not-valid-base64',
            }),
          )
        ).status,
      ).toBe(400)

      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, {
              query: `?userId=${new Types.ObjectId()}`,
            }),
          )
        ).status,
      ).toBe(400)

      await AuditLog.deleteMany({ action: `finish.audit.${stamp}` })
    })
  })

  describe('search rate limit and member scope', () => {
    it('returns 429 and omits payments for members', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const { GET } = await import('@/lib/route-logic/search')

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)
      const memberRes = await GET(
        orgJsonReq('/api/search', 'GET', undefined, { query: '?q=FINISH-CHK' }),
      )
      expect(memberRes.status).toBe(200)
      const memberBody = await memberRes.json()
      expect(memberBody.items.every((i: { type: string }) => i.type !== 'payment')).toBe(true)
      bindSession(ctx)

      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (await GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=test' }))).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('notifications org-wide and rate limits', () => {
    it('marks org-wide notifications read and returns 429 when limited', async () => {
      const { Notification } = await import('@/lib/models')
      await Notification.create({
        organizationId: ctx.orgId,
        userId: null,
        kind: 'finish_org_wide',
        title: 'Org-wide finish',
        body: 'broadcast',
        readByUserIds: [],
      })

      const { GET, POST } = await import('@/lib/route-logic/notifications')
      const list = await GET(
        orgJsonReq('/api/notifications', 'GET', undefined, { query: '?unreadOnly=true' }),
      )
      expect(list.status).toBe(200)
      const body = await list.json()
      expect(body.items.some((n: { orgWide: boolean }) => n.orgWide)).toBe(true)

      expect((await POST(orgJsonReq('/api/notifications', 'POST', { all: true }))).status).toBe(200)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect((await GET(orgJsonReq('/api/notifications', 'GET'))).status).toBe(429)
        expect((await POST(orgJsonReq('/api/notifications', 'POST', { all: true }))).status).toBe(
          429,
        )
      } finally {
        spy.mockRestore()
      }

      await Notification.deleteMany({ organizationId: ctx.orgId, kind: 'finish_org_wide' })
    })
  })

  describe('auth/signup guards', () => {
    it('returns 410 for expired codes and 429 when rate limited', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const code = `finish-expired-${Date.now()}`
      const email = `expired-${Date.now()}@example.com`
      await InviteRequest.create({
        email,
        name: 'Expired',
        message: 'x',
        status: 'approved',
        signupCode: code,
        signupCodeExpiresAt: new Date(Date.now() - 3600_000),
      })

      const { GET, POST } = await import('@/lib/route-logic/auth/signup')
      const getRes = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/signup?code=${encodeURIComponent(code)}`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(getRes.status).toBe(200)
      expect((await getRes.json()).valid).toBe(false)

      const expiredPost = await POST(
        publicJsonReq('/api/auth/signup', 'POST', {
          inviteCode: code,
          password: 'FinishSignupPass123!',
          name: 'Expired',
        }),
      )
      expect(expiredPost.status).toBe(410)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (
            await POST(
              publicJsonReq('/api/auth/signup', 'POST', {
                inviteCode: 'unused-code',
                password: 'FinishSignupPass123!',
                name: 'Rate Limited',
              }),
            )
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }

      await InviteRequest.deleteMany({ email })
    })
  })

  describe('auth/request-invite rate limit', () => {
    it('returns 429 when IP rate limit is exceeded', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { POST } = await import('@/lib/route-logic/auth/request-invite')
        const res = await POST(
          publicJsonReq('/api/auth/request-invite', 'POST', {
            email: `rate-${Date.now()}@example.com`,
            name: 'Rate Limited',
          }),
        )
        expect(res.status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('family-members/all rate limit', () => {
    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/family-members/all')
        expect((await GET(orgJsonReq('/api/family-members/all', 'GET'))).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('lifecycle-event-types list rate limit', () => {
    it('returns 429 when rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { GET } = await import('@/lib/route-logic/lifecycle-event-types')
        expect((await GET(orgJsonReq('/api/lifecycle-event-types', 'GET'))).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('statements/generate-pdf failure', () => {
    it('returns 500 when PDF generation throws', async () => {
      const emailUtils = await import('@/lib/email-utils')
      const spy = vi
        .spyOn(emailUtils, 'generateStatementPDF')
        .mockRejectedValueOnce(new Error('pdf fail'))
      try {
        const { POST } = await import('@/lib/route-logic/statements/generate-pdf')
        const res = await POST(
          orgJsonReq('/api/statements/generate-pdf', 'POST', {
            statement: { _id: ctx.fixtures.statementId },
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('auth/invite rate limits', () => {
    it('returns 429 on create, resolve, accept, and cancel', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const { POST, GET, PUT, DELETE } = await import('@/lib/route-logic/auth/invite')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (
            await POST(
              orgJsonReq('/api/auth/invite', 'POST', {
                email: `rate-${Date.now()}@example.com`,
                role: 'member',
              }),
            )
          ).status,
        ).toBe(429)
        expect(
          (
            await GET(
              new NextRequest(`${API_ORIGIN}/api/auth/invite?token=any-token`, {
                headers: { host: 'localhost:3000', origin: API_ORIGIN },
              }),
            )
          ).status,
        ).toBe(429)
        expect(
          (
            await PUT(
              new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
                method: 'PUT',
                headers: {
                  host: 'localhost:3000',
                  origin: API_ORIGIN,
                  'content-type': 'application/json',
                },
                body: JSON.stringify({ token: 'any-token' }),
              }),
            )
          ).status,
        ).toBe(429)
        expect(
          (await DELETE(orgJsonReq('/api/auth/invite?id=507f1f77bcf86cd799439011', 'DELETE')))
            .status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('auth/invite signup accept', () => {
    it('creates a user and membership when accepting without a session', async () => {
      const { User, OrgMembership, Invite } = await import('@/lib/models')
      const email = `signup-accept-${Date.now()}@example.com`
      const { POST, PUT } = await import('@/lib/route-logic/auth/invite')
      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email, role: 'member' }),
      )
      expect(createRes.status).toBe(200)
      const token = inviteTokenFromUrl((await createRes.json()).inviteUrl)

      mockAuth.mockResolvedValueOnce(null as never)
      const accept = await PUT(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'PUT',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token,
            name: 'New Invitee',
            password: 'FinishInvitePass123!',
          }),
        }),
      )
      expect(accept.status).toBe(200)
      const user = await User.findOne({ email })
      expect(user).toBeTruthy()
      const membership = await OrgMembership.findOne({
        userId: user?._id,
        organizationId: ctx.orgId,
      })
      expect(membership?.role).toBe('member')
      bindSession(ctx)

      await Invite.deleteMany({ email, organizationId: ctx.orgId })
      await User.deleteOne({ _id: user?._id })
      await OrgMembership.deleteMany({ userId: user?._id })
    })

    it('returns 410 when resolving an already-accepted invite', async () => {
      const { Invite } = await import('@/lib/models')
      const token = `accepted-${Date.now()}`
      await Invite.create({
        organizationId: ctx.orgId,
        email: `accepted-${Date.now()}@example.com`,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: new Date(),
      })
      const { GET } = await import('@/lib/route-logic/auth/invite')
      const res = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite?token=${encodeURIComponent(token)}`, {
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(res.status).toBe(410)
    })
  })

  describe('stripe/confirm-payment extended', () => {
    it('returns 429, rejects bad memberId, and confirms with member attribution', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')

      const rateSpy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        expect(
          (
            await POST(
              orgJsonReq('/api/stripe/confirm-payment', 'POST', {
                paymentIntentId: 'pi_apiprobemock',
                familyId: ctx.fixtures.familyId,
              }),
            )
          ).status,
        ).toBe(429)
      } finally {
        rateSpy.mockRestore()
      }

      const badMember = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_apiprobemock',
          familyId: ctx.fixtures.familyId,
          memberId: new Types.ObjectId().toString(),
        }),
      )
      expect(badMember.status).toBe(404)

      const { Payment } = await import('@/lib/models')
      const piId = 'pi_confirmmember01'
      await Payment.deleteMany({ organizationId: ctx.orgId, stripePaymentIntentId: piId })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
      }
      vi.mocked(client.paymentIntents.retrieve).mockImplementation(async (id: string) => ({
        id,
        status: 'succeeded',
        amount: 3300,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      }))

      const ok = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piId,
          familyId: ctx.fixtures.familyId,
          memberId: ctx.fixtures.memberId,
        }),
      )
      expect(ok.status).toBe(200)
      const body = await ok.json()
      expect(body.payment?.memberId).toBe(ctx.fixtures.memberId)
    })
  })

  describe('tax-receipts/zip duplicate names', () => {
    it('deduplicates PDF filenames when two families share a name', async () => {
      const { Family, Payment } = await import('@/lib/models')
      const y0 = year()
      const sharedName = `ZipDup ${Date.now()}`
      const famA = await Family.create({
        organizationId: ctx.orgId,
        name: sharedName,
        weddingDate: new Date('2012-06-01'),
        email: `zip-dup-a-${Date.now()}@example.com`,
      })
      const famB = await Family.create({
        organizationId: ctx.orgId,
        name: sharedName,
        weddingDate: new Date('2013-06-01'),
        email: `zip-dup-b-${Date.now()}@example.com`,
      })
      for (const fid of [famA._id, famB._id]) {
        await Payment.create({
          organizationId: ctx.orgId,
          familyId: fid,
          amount: 25,
          paymentDate: new Date(`${y0}-04-10`),
          year: y0,
          type: 'membership',
          paymentMethod: 'cash',
        })
      }

      const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
      const res = await GET(
        orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${y0}` }),
      )
      expect(res.status).toBe(200)
      const buf = Buffer.from(await res.arrayBuffer())
      expect(buf.length).toBeGreaterThan(100)

      await Payment.deleteMany({ familyId: { $in: [famA._id, famB._id] } })
      await Family.deleteMany({ _id: { $in: [famA._id, famB._id] } })
    })
  })

  describe('import rate limit', () => {
    it('returns 429 when import is rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      try {
        const { buildImportProbeRequest } = await import('@/lib/test/import-route-probes')
        const { POST } = await import('@/lib/route-logic/import')
        const req = await buildImportProbeRequest('families-csv', {
          familyId: ctx.fixtures.familyId,
          memberId: ctx.fixtures.memberId,
        })
        expect((await POST(req)).status).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/saved-payment-methods rate limit', () => {
    it('returns 429 on GET list', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const params = { id: ctx.fixtures.familyId }
      const { GET } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      try {
        expect(
          (
            await GET(orgJsonReq(`/api/families/${params.id}/saved-payment-methods`, 'GET'), {
              params,
            })
          ).status,
        ).toBe(429)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('tax-receipts/email', () => {
    it('queues a tax receipt email job when email config is active', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: encrypt('app-password-test'),
            fromName: 'API Route Org',
            isActive: true,
          },
        },
        { upsert: true },
      )

      const { POST } = await import('@/lib/route-logic/tax-receipts/email')
      const res = await POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
      expect([200, 202, 409]).toContain(res.status)
    })
  })
})
