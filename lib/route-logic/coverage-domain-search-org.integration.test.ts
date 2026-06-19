/**
 * Branch-coverage for search, org settings, events, dashboard, cycle-config,
 * notifications, and user profile route-logic domains.
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

describe.sequential('route-logic search/org domain coverage', () => {
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

  describe('search', () => {
    it('returns payment hits for admin with check and card refs', async () => {
      bindSession(ctx, 'admin')
      const { Payment } = await import('@/lib/models')
      const token = `SRCHPAY${Date.now()}`
      const payment = await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 42,
        paymentDate: new Date(),
        year: year(),
        notes: `note ${token}`,
        checkInfo: { checkNumber: token, bankName: 'Test Bank' },
      })
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${token}` }))
      expect(res.status).toBe(200)
      const body = await res.json()
      const hit = body.items.find((i: { type: string }) => i.type === 'payment')
      expect(hit?.label).toContain('42')
      expect(hit?.sublabel).toContain(`Check #${token}`)
      await Payment.deleteOne({ _id: payment._id })
    })

    it('matches card last4 and skips payments for members or short queries', async () => {
      const { Payment } = await import('@/lib/models')
      const last4 = `${Date.now()}`.slice(-4)
      const payment = await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 5,
        paymentDate: new Date(),
        year: year(),
        ccInfo: { last4 },
      })
      const { GET } = await import('@/lib/route-logic/search')

      bindSession(ctx, 'member')
      const memberRes = await GET(
        orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${last4}` }),
      )
      const memberBody = await memberRes.json()
      expect(memberBody.items.every((i: { type: string }) => i.type !== 'payment')).toBe(true)

      bindSession(ctx, 'admin')
      const shortRes = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=ab' }))
      const shortBody = await shortRes.json()
      expect(shortBody.items.every((i: { type: string }) => i.type !== 'payment')).toBe(true)

      const cardRes = await GET(
        orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${last4}` }),
      )
      const cardBody = await cardRes.json()
      const cardHit = cardBody.items.find((i: { type: string }) => i.type === 'payment')
      expect(cardHit?.sublabel).toContain(`••${last4}`)

      await Payment.deleteOne({ _id: payment._id })
    })

    it('uses hebrew names and family sublabels on hits', async () => {
      bindSession(ctx)
      const { Family, FamilyMember } = await import('@/lib/models')
      const stamp = `SRCHHB${Date.now()}`
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `${stamp} Family`,
        hebrewName: `משפחת ${stamp}`,
        weddingDate: new Date('2012-01-01'),
      })
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: fam._id,
        firstName: 'Placeholder',
        lastName: 'Member',
        hebrewFirstName: 'יעקב',
        hebrewLastName: stamp,
      })
      await FamilyMember.updateOne({ _id: member._id }, { $set: { firstName: '', lastName: '' } })
      const { GET } = await import('@/lib/route-logic/search')

      const famRes = await GET(
        orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${stamp}` }),
      )
      const famBody = await famRes.json()
      const familyHit = famBody.items.find((i: { type: string }) => i.type === 'family')
      expect(familyHit?.sublabel).toContain(`משפחת ${stamp}`)

      const memRes = await GET(
        orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${stamp}` }),
      )
      const memBody = await memRes.json()
      const memberHit = memBody.items.find((i: { type: string }) => i.type === 'member')
      expect(memberHit?.label).toContain(stamp)
      expect(memberHit?.sublabel).toContain(`${stamp} Family`)

      await FamilyMember.deleteOne({ _id: member._id })
      await Family.deleteOne({ _id: fam._id })
    })

    it('uses email sublabel on families and omits orphan payment hits', async () => {
      bindSession(ctx, 'admin')
      const { Family, Payment } = await import('@/lib/models')
      const stamp = `SRCHEM${Date.now()}`
      const fam = await Family.create({
        organizationId: ctx.orgId,
        name: `${stamp} Email Fam`,
        email: `${stamp}@example.com`,
        weddingDate: new Date('2011-01-01'),
      })
      const orphanPay = await Payment.create({
        organizationId: ctx.orgId,
        familyId: new Types.ObjectId(),
        amount: 9,
        paymentDate: new Date(),
        year: year(),
        notes: `orphan ${stamp}`,
      })
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${stamp}` }))
      const body = await res.json()
      const familyHit = body.items.find((i: { type: string }) => i.type === 'family')
      expect(familyHit?.sublabel).toBe(`${stamp}@example.com`)
      expect(body.items.every((i: { type: string }) => i.type !== 'payment')).toBe(true)
      await Payment.deleteOne({ _id: orphanPay._id })
      await Family.deleteOne({ _id: fam._id })
    })

    it('uses strict rate limit when SECURITY_STRICT_RATE_LIMITS is set', async () => {
      bindSession(ctx)
      const prev = process.env.SECURITY_STRICT_RATE_LIMITS
      process.env.SECURITY_STRICT_RATE_LIMITS = '1'
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit')
      try {
        const { GET } = await import('@/lib/route-logic/search')
        await GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=test' }))
        expect(spy).toHaveBeenCalledWith(
          expect.anything(),
          'search',
          expect.objectContaining({ limit: 20 }),
          ctx.orgId,
        )
      } finally {
        spy.mockRestore()
        if (prev === undefined) delete process.env.SECURITY_STRICT_RATE_LIMITS
        else process.env.SECURITY_STRICT_RATE_LIMITS = prev
      }
    })
  })

  describe('organizations/current', () => {
    it('GET returns org fields and PATCH updates currency and locale', async () => {
      bindSession(ctx, 'admin')
      const { GET, PATCH } = await import('@/lib/route-logic/organizations/current')

      const getRes = await GET(orgJsonReq('/api/organizations/current', 'GET'))
      expect(getRes.status).toBe(200)
      const org = await getRes.json()
      expect(org.id).toBe(ctx.orgId)
      expect(org.currency).toBeTruthy()

      const patchRes = await PATCH(
        orgJsonReq('/api/organizations/current', 'PATCH', {
          currency: 'EUR',
          locale: 'fr-FR',
        }),
      )
      expect(patchRes.status).toBe(200)
      const updated = await patchRes.json()
      expect(updated.currency).toBe('EUR')
      expect(updated.locale).toBe('fr-FR')

      const noop = await PATCH(orgJsonReq('/api/organizations/current', 'PATCH', {}))
      expect(noop.status).toBe(200)
      expect((await noop.json()).noop).toBe(true)

      await PATCH(
        orgJsonReq('/api/organizations/current', 'PATCH', { currency: 'USD', locale: 'en-US' }),
      )
    })
  })

  describe('events', () => {
    it('labels unknown event types and resolves soft-deleted family names', async () => {
      bindSession(ctx, 'admin')
      const { LifecycleEventPayment, Family } = await import('@/lib/models')
      const y = year()
      const deletedFam = await Family.create({
        organizationId: ctx.orgId,
        name: `Deleted Fam ${Date.now()}`,
        weddingDate: new Date('2010-01-01'),
        deletedAt: new Date(),
      })
      const payment = await LifecycleEventPayment.create({
        organizationId: ctx.orgId,
        familyId: deletedFam._id,
        eventType: 'custom_unknown_type',
        eventDate: new Date(`${y}-03-15`),
        year: y,
        amount: 25,
      })

      const { GET } = await import('@/lib/route-logic/events')
      const res = await GET(orgJsonReq('/api/events', 'GET'))
      expect(res.status).toBe(200)
      const rows = await res.json()
      const row = rows.find((r: { eventType: string }) => r.eventType === 'custom_unknown_type')
      expect(row?.eventTypeLabel).toBe('custom_unknown_type')
      expect(row?.familyName).toBe(deletedFam.name)

      const pag = await import('@/lib/pagination')
      const orphanSpy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementationOnce(async () => [
          {
            _id: new Types.ObjectId(),
            eventType: 'orphan_event',
            eventDate: new Date(`${y}-04-01`),
            year: y,
            amount: 10,
          },
        ])
      const res2 = await GET(orgJsonReq('/api/events', 'GET'))
      orphanSpy.mockRestore()
      const rows2 = await res2.json()
      const orphan = rows2.find((r: { eventType: string }) => r.eventType === 'orphan_event')
      expect(orphan?.familyName).toBe('Unknown Family')
      expect(orphan?.familyId).toBeUndefined()

      await LifecycleEventPayment.deleteOne({ _id: payment._id })
      await Family.deleteOne({ _id: deletedFam._id })
    })
  })

  describe('dashboard-stats', () => {
    it('omits financial fields for members and uses saved YearlyCalculation', async () => {
      const { YearlyCalculation } = await import('@/lib/models')
      const y = year()
      await YearlyCalculation.findOneAndUpdate(
        { organizationId: ctx.orgId, year: y },
        {
          $set: {
            calculatedIncome: 500,
            calculatedExpenses: 100,
            balance: 400,
          },
        },
        { upsert: true },
      )

      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/dashboard-stats')
      const adminRes = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}` }),
      )
      const adminBody = await adminRes.json()
      expect(adminBody.calculatedIncome).toBe(500)
      expect(adminBody.balance).toBe(adminBody.calculatedIncome - adminBody.calculatedExpenses)

      bindSession(ctx, 'member')
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)
      const memberRes = await GET(orgJsonReq('/api/dashboard-stats', 'GET'))
      const memberBody = await memberRes.json()
      expect(memberBody.totalFamilies).toBeGreaterThanOrEqual(0)
      expect(memberBody.calculatedIncome).toBeUndefined()
      bindSession(ctx)
    })

    it('derives balance from income minus live expenses when balance field omitted', async () => {
      bindSession(ctx, 'admin')
      const { YearlyCalculation } = await import('@/lib/models')
      const y = year() + 50
      await YearlyCalculation.findOneAndUpdate(
        { organizationId: ctx.orgId, year: y },
        {
          $set: { calculatedIncome: 200, calculatedExpenses: 50 },
          $unset: { balance: '' },
        },
        { upsert: true },
      )
      const { GET } = await import('@/lib/route-logic/dashboard-stats')
      const res = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}` }),
      )
      const body = await res.json()
      expect(body.calculatedIncome).toBe(200)
      expect(body.balance).toBe(body.calculatedIncome - body.calculatedExpenses)
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })
    })
  })

  describe('cycle-config', () => {
    it('creates hebrew calendar config and updates existing config', async () => {
      bindSession(ctx, 'admin')
      const { CycleConfig } = await import('@/lib/models')
      await CycleConfig.deleteMany({ organizationId: ctx.orgId })

      const { GET, POST } = await import('@/lib/route-logic/cycle-config')
      const defaults = await GET(orgJsonReq('/api/cycle-config', 'GET'))
      const defaultsBody = await defaults.json()
      expect(defaultsBody.cycleCalendar).toBe('gregorian')

      const createRes = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'hebrew',
          cycleStartMonth: 9,
          cycleStartDay: 1,
          cycleStartHebrewMonth: 7,
          cycleStartHebrewDay: 1,
          cycleAutoRollover: true,
        }),
      )
      expect(createRes.status).toBe(201)

      const updateRes = await POST(
        orgJsonReq('/api/cycle-config', 'POST', {
          cycleCalendar: 'hebrew',
          cycleStartMonth: 10,
          cycleStartDay: 15,
          cycleStartHebrewMonth: 8,
          cycleStartHebrewDay: 2,
          description: 'Updated cycle',
        }),
      )
      expect(updateRes.status).toBe(200)
      const updated = await updateRes.json()
      expect(updated.cycleStartMonth).toBe(10)
      expect(updated.description).toBe('Updated cycle')
    })
  })

  describe('notifications', () => {
    it('tracks per-user and org-wide read state and marks by ids', async () => {
      bindSession(ctx)
      const { Notification } = await import('@/lib/models')
      const perUser = await Notification.create({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        kind: 'task.due',
        title: 'Per user',
        body: 'unread',
        readAt: null,
      })
      const orgWide = await Notification.create({
        organizationId: ctx.orgId,
        userId: null,
        kind: 'announcement',
        title: 'Org wide',
        body: 'visible',
        readByUserIds: [],
      })

      const { GET, POST } = await import('@/lib/route-logic/notifications')
      const list = await GET(orgJsonReq('/api/notifications', 'GET'))
      const body = await list.json()
      const perUserItem = body.items.find((n: { _id: string }) => n._id === perUser._id.toString())
      const orgWideItem = body.items.find((n: { _id: string }) => n._id === orgWide._id.toString())
      expect(perUserItem?.read).toBe(false)
      expect(orgWideItem?.orgWide).toBe(true)
      expect(orgWideItem?.read).toBe(false)

      await POST(
        orgJsonReq('/api/notifications', 'POST', {
          ids: [perUser._id.toString(), orgWide._id.toString()],
        }),
      )

      const after = await GET(orgJsonReq('/api/notifications', 'GET'))
      const afterBody = await after.json()
      expect(
        afterBody.items.find((n: { _id: string }) => n._id === perUser._id.toString())?.read,
      ).toBe(true)
      expect(
        afterBody.items.find((n: { _id: string }) => n._id === orgWide._id.toString())?.read,
      ).toBe(true)

      await Notification.deleteMany({ _id: { $in: [perUser._id, orgWide._id] } })
    })
  })

  describe('user profile', () => {
    it('GET returns profile and PATCH updates name with audit', async () => {
      const { GET, PATCH } = await import('@/lib/route-logic/user')
      const getRes = await GET(sessionJsonReq('/api/user', 'GET'))
      expect(getRes.status).toBe(200)
      const profile = await getRes.json()
      expect(profile.email).toBe(ctx.email)

      const newName = `RL User ${Date.now()}`
      const patchRes = await PATCH(sessionJsonReq('/api/user', 'PATCH', { name: newName }))
      expect(patchRes.status).toBe(200)
      expect((await patchRes.json()).name).toBe(newName)
    })
  })

  describe('trash/purge-all', () => {
    it('returns plural purge message when multiple items removed', async () => {
      bindSession(ctx, 'owner')
      const recycle = await import('@/lib/recycle-bin')
      const spy = vi.spyOn(recycle, 'purgeAll').mockResolvedValueOnce({
        families: 2,
        members: 1,
      } as never)
      try {
        const { POST } = await import('@/lib/route-logic/trash/purge-all')
        const res = await POST(orgJsonReq('/api/trash/purge-all', 'POST'))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.message).toContain('3 items')
      } finally {
        spy.mockRestore()
      }
    })
  })
})
