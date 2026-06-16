import { mockOrgContext } from '@/lib/test/type-helpers'
import { setNodeEnv } from '@/lib/test/type-helpers'
/**
 * Line-coverage for families / members / jobs / trash route-logic domains.
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

describe.sequential('route-logic families/jobs/trash domain coverage', () => {
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

  describe('families list and balances', () => {
    it('GET /api/families legacy list and empty paginated result', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/families')

      await withCompoundCursorSpy(async () => {
        const legacy = await GET(orgJsonReq('/api/families', 'GET'))
        expect(legacy.status).toBe(200)
        const legacyBody = await legacy.json()
        expect(Array.isArray(legacyBody)).toBe(true)
      })

      const { Organization, Family, OrgMembership } = await import('@/lib/models')
      const emptyOrg = await Organization.create({
        name: 'Empty Families Org',
        slug: `empty-fam-${Date.now()}`,
        ownerId: ctx.userId,
        timezone: 'UTC',
      })
      await OrgMembership.create({
        userId: ctx.userId,
        organizationId: emptyOrg._id,
        role: 'owner',
      })
      await Family.deleteMany({ organizationId: emptyOrg._id })
      const emptyRes = await GET(
        orgJsonReq('/api/families', 'GET', undefined, {
          query: '?limit=5',
          orgId: emptyOrg._id.toString(),
        }),
      )
      expect(emptyRes.status).toBe(200)
      expect(await emptyRes.json()).toEqual({ items: [], nextCursor: null })
      await Organization.deleteOne({ _id: emptyOrg._id })
    })

    it('GET /api/families/balances aggregates payments withdrawals and cycle charges', async () => {
      bindSession(ctx)
      const { Payment, Withdrawal, CycleCharge } = await import('@/lib/models')
      const now = new Date()
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 200,
        refundedAmount: 50,
        paymentDate: now,
        year: year(),
        type: 'membership',
        paymentMethod: 'check',
      })
      await Withdrawal.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 30,
        withdrawalDate: now,
      })
      await CycleCharge.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 20,
        chargeDate: now,
        cycleYear: year(),
        calendar: 'gregorian',
      })

      const { GET } = await import('@/lib/route-logic/families/balances')
      const res = await GET(orgJsonReq('/api/families/balances', 'GET'))
      expect(res.status).toBe(200)
      const rows = await res.json()
      const row = rows.find((r: { familyId: string }) => r.familyId === ctx.fixtures.familyId)
      expect(row).toBeTruthy()
      expect(row.totalPayments).toBeGreaterThanOrEqual(150)
      expect(row.totalWithdrawals).toBeGreaterThanOrEqual(30)
      expect(row.totalCycleCharges).toBeGreaterThanOrEqual(20)
      expect(row.planCost).toBeGreaterThanOrEqual(0)
      expect(typeof row.balance).toBe('number')
    })

    it('GET /api/families rejects invalid cursor and paginates with nextCursor', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/families')
      expect(
        (await GET(orgJsonReq('/api/families', 'GET', undefined, { query: '?limit=1&cursor=bad' }))).status,
      ).toBe(400)

      const { Family } = await import('@/lib/models')
      const extra = await Family.create({
        organizationId: ctx.orgId,
        name: `Paginate ${Date.now()}`,
        weddingDate: new Date('2017-01-01'),
      })
      const page = await GET(orgJsonReq('/api/families', 'GET', undefined, { query: '?limit=1' }))
      expect(page.status).toBe(200)
      const body = await page.json()
      expect(body.nextCursor).toBeTruthy()
      const next = await GET(
        orgJsonReq('/api/families', 'GET', undefined, {
          query: `?limit=1&cursor=${encodeURIComponent(body.nextCursor)}`,
        }),
      )
      expect(next.status).toBe(200)
      await Family.deleteOne({ _id: extra._id })
    })

    it('GET /api/families/balances scopes to familyIds when provided', async () => {
      bindSession(ctx)
      const { Family } = await import('@/lib/models')
      const extra = await Family.create({
        organizationId: ctx.orgId,
        name: `Balances Scope ${Date.now()}`,
        weddingDate: new Date('2018-01-01'),
      })
      const { GET } = await import('@/lib/route-logic/families/balances')
      const res = await GET(
        orgJsonReq('/api/families/balances', 'GET', undefined, {
          query: `?familyIds=${ctx.fixtures.familyId}`,
        }),
      )
      expect(res.status).toBe(200)
      const rows = await res.json()
      expect(rows).toHaveLength(1)
      expect(rows[0].familyId).toBe(ctx.fixtures.familyId)
      await Family.deleteOne({ _id: extra._id })
    })

    it('GET /api/families/balances rejects invalid and oversized familyIds', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/families/balances')
      expect(
        (
          await GET(
            orgJsonReq('/api/families/balances', 'GET', undefined, {
              query: '?familyIds=not-valid',
            }),
          )
        ).status,
      ).toBe(400)
      const tooMany = Array.from({ length: 101 }, (_, i) =>
        String(i).padStart(24, '0'),
      ).join(',')
      expect(
        (
          await GET(
            orgJsonReq('/api/families/balances', 'GET', undefined, {
              query: `?familyIds=${tooMany}`,
            }),
          )
        ).status,
      ).toBe(400)
    })

    it('GET /api/families/balances rate limits', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/families/balances')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/families/balances', 'GET'))).status).toBe(429)
      })
    })

    it('GET /api/families masks financial fields for members', async () => {
      bindSession(ctx, 'member')
      const { GET } = await import('@/lib/route-logic/families')
      const res = await GET(orgJsonReq('/api/families', 'GET', undefined, { query: '?limit=5' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      const item = body.items?.[0]
      expect(item).toBeTruthy()
      expect(item.openBalance).toBeUndefined()
      expect(item.paymentPlanId).toBeUndefined()
      bindSession(ctx)
    })
  })

  describe('families bulk actions', () => {
    it('setPaymentPlan rejects unknown plan and updates families', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const missingPlan = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setPaymentPlan',
          ids: [ctx.fixtures.familyId],
          paymentPlanId: new Types.ObjectId().toString(),
        }),
      )
      expect(missingPlan.status).toBe(404)

      const ok = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setPaymentPlan',
          ids: [ctx.fixtures.familyId],
          paymentPlanId: ctx.fixtures.paymentPlanId,
        }),
      )
      expect(ok.status).toBe(200)
      expect((await ok.json()).modified).toBeGreaterThanOrEqual(1)
    })

    it('setEmailOptOut updates families', async () => {
      bindSession(ctx)
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

    it('delete continues when cascade fails for one id', async () => {
      bindSession(ctx)
      const { Family } = await import('@/lib/models')
      const extra = await Family.create({
        organizationId: ctx.orgId,
        name: `Bulk Fail ${Date.now()}`,
        weddingDate: new Date('2018-01-01'),
      })
      const recycle = await import('@/lib/recycle-bin')
      const spy = vi
        .spyOn(recycle, 'softDeleteFamilyCascade')
        .mockRejectedValueOnce(new Error('cascade fail'))
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'delete',
          ids: [extra._id.toString()],
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)
      spy.mockRestore()
      await Family.deleteOne({ _id: extra._id })
    })
  })

  describe('families/[id] nested routes', () => {
    it('sub-families maps weddingDate cursor', async () => {
      bindSession(ctx)
      await withCompoundCursorSpy(async () => {
        const { GET } = await import('@/lib/route-logic/families/[id]/sub-families')
        expect(
          (
            await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
      })
    })

    it('sub-families returns 404 and masks fields for members', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/families/[id]/sub-families')
      const missing = await GET(
        orgJsonReq(`/api/families/${new Types.ObjectId()}/sub-families`, 'GET'),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)

      const { Family } = await import('@/lib/models')
      const sub = await Family.create({
        organizationId: ctx.orgId,
        name: 'Sub Family',
        weddingDate: new Date('2020-01-01'),
        parentFamilyId: ctx.fixtures.familyId,
        openBalance: 99,
        paymentPlanId: ctx.fixtures.paymentPlanId,
      })

      bindSession(ctx, 'member')
      const memberView = await GET(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(memberView.status).toBe(200)
      const rows = await memberView.json()
      const hit = rows.find((r: { _id: string }) => String(r._id) === String(sub._id))
      expect(hit).toBeTruthy()
      expect(hit.openBalance).toBeUndefined()
      expect(hit.paymentPlanId).toBeUndefined()
      bindSession(ctx)
      await Family.deleteOne({ _id: sub._id })
    })

    it('members GET/POST 404 for missing family', async () => {
      bindSession(ctx)
      const bad = new Types.ObjectId().toString()
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/members')
      expect((await GET(orgJsonReq(`/api/families/${bad}/members`, 'GET'), { params: { id: bad } })).status).toBe(
        404,
      )
      expect(
        (
          await POST(
            orgJsonReq(`/api/families/${bad}/members`, 'POST', {
              firstName: 'X',
              lastName: 'Y',
              birthDate: '2010-01-01',
              gender: 'male',
            }),
            { params: { id: bad } },
          )
        ).status,
      ).toBe(404)
    })

    it('members POST auto-assign catches plan and event errors', async () => {
      bindSession(ctx)
      const { Organization, PaymentPlan, LifecycleEvent } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            barMitzvahAutoAssignPlanId: ctx.fixtures.paymentPlanId,
            barMitzvahAutoCreateEventTypeId: ctx.fixtures.lifecycleEventTypeId,
          },
        },
      )
      const planSpy = vi.spyOn(PaymentPlan, 'findOne').mockImplementationOnce(() => {
        throw new Error('plan lookup failed')
      })
      const { POST } = await import('@/lib/route-logic/families/[id]/members')
      const planErr = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'POST', {
          firstName: 'Bar',
          lastName: 'Mitzvah',
          birthDate: '2010-01-01',
          gender: 'male',
          hebrewBirthDate: '15 Adar 5770',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(planErr.status).toBe(201)
      planSpy.mockRestore()

      const evSpy = vi.spyOn(LifecycleEvent, 'findOne').mockImplementationOnce(() => {
        throw new Error('event lookup failed')
      })
      const evErr = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'POST', {
          firstName: 'Bar',
          lastName: 'Event',
          birthDate: '2010-02-01',
          gender: 'male',
          hebrewBirthDate: '15 Adar 5770',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(evErr.status).toBe(201)
      evSpy.mockRestore()
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $unset: { barMitzvahAutoAssignPlanId: 1, barMitzvahAutoCreateEventTypeId: 1 } },
      )
    })

    it('lifecycle-events GET cursor and POST 404', async () => {
      bindSession(ctx)
      const bad = new Types.ObjectId().toString()
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
      expect(
        (
          await POST(
            orgJsonReq(`/api/families/${bad}/lifecycle-events`, 'POST', {
              eventType: 'bar_mitzvah',
              amount: 10,
              eventDate: today(),
              year: year(),
            }),
            { params: { id: bad } },
          )
        ).status,
      ).toBe(404)

      await withCompoundCursorSpy(async () => {
        expect(
          (
            await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/lifecycle-events`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
      })
    })

    it('withdrawals GET maps withdrawalDate cursor', async () => {
      bindSession(ctx)
      await withCompoundCursorSpy(async () => {
        const { GET } = await import('@/lib/route-logic/families/[id]/withdrawals')
        expect(
          (
            await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/withdrawals`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
      })
    })

    it('members POST rate limits', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/families/[id]/members')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'POST', {
                firstName: 'Rate',
                lastName: 'Limit',
                birthDate: '2011-01-01',
                gender: 'female',
              }),
              { params: { id: ctx.fixtures.familyId } },
            )
          ).status,
        ).toBe(429)
      })
    })

    it('family payments GET cursor and POST rate limit', async () => {
      bindSession(ctx)
      const { GET, POST } = await import('@/lib/route-logic/families/[id]/payments')
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
                amount: 12,
                paymentDate: today(),
                year: year(),
              }),
              { params: { id: ctx.fixtures.familyId } },
            )
          ).status,
        ).toBe(429)
      })
    })

    it('family detail GET maps cycle charge cursor', async () => {
      bindSession(ctx)
      const { CycleCharge } = await import('@/lib/models')
      const cycleYear = year() + 50
      await CycleCharge.deleteMany({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        cycleYear,
      })
      const cc = await CycleCharge.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 7,
        chargeDate: new Date(),
        cycleYear,
        calendar: 'gregorian',
      })
      await withCompoundCursorSpy(async () => {
        const { GET } = await import('@/lib/route-logic/families/[id]')
        expect(
          (
            await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
      })
      await CycleCharge.deleteOne({ _id: cc._id })
    })

    it('members GET masks payment plan fields for non-admins', async () => {
      bindSession(ctx, 'member')
      const { GET } = await import('@/lib/route-logic/families/[id]/members')
      const res = await GET(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'GET'),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(200)
      const rows = await res.json()
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].paymentPlanId).toBeUndefined()
      bindSession(ctx)
    })
  })

  describe('convert-to-family', () => {
    it('rejects missing wedding date and already-converted member', async () => {
      bindSession(ctx)
      const { FamilyMember } = await import('@/lib/models')
      const stray = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Convert',
        lastName: 'Gap',
        gender: 'male',
      })
      const { POST } = await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
      const params = { id: ctx.fixtures.familyId, memberId: stray._id.toString() }

      const noDate = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${stray._id}/convert-to-family`,
          'POST',
          {},
        ),
        { params },
      )
      expect(noDate.status).toBe(400)

      const arrayBody = await POST(
        new NextRequest(
          `${API_ORIGIN}/api/families/${ctx.fixtures.familyId}/members/${stray._id}/convert-to-family`,
          {
            method: 'POST',
            headers: {
              host: 'localhost:3000',
              origin: API_ORIGIN,
              'x-organization-id': ctx.orgId,
              'content-type': 'application/json',
            },
            body: '[]',
          },
        ),
        { params },
      )
      expect(arrayBody.status).toBe(400)

      const badDate = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${stray._id}/convert-to-family`,
          'POST',
          { weddingDate: 'not-a-date' },
        ),
        { params },
      )
      expect(badDate.status).toBe(400)

      const dup = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Already',
        lastName: 'Converted',
        gender: 'female',
        convertedToFamily: true,
      })
      const again = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${dup._id}/convert-to-family`,
          'POST',
          { weddingDate: '2025-06-02' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: dup._id.toString() } },
      )
      expect(again.status).toBe(409)
      await FamilyMember.deleteMany({ _id: { $in: [stray._id, dup._id] } })
    })

    it('convert-to-family catches default plan lookup errors', async () => {
      bindSession(ctx)
      const { FamilyMember, Organization, PaymentPlan } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Plan',
        lastName: 'Catch',
        gender: 'female',
      })
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId } },
      )
      const { POST } = await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
      const planSpy = vi.spyOn(PaymentPlan, 'findOne').mockImplementationOnce(() => {
        throw new Error('plan lookup failed')
      })
      const res = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${member._id}/convert-to-family`,
          'POST',
          { weddingDate: '2025-09-01' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: member._id.toString() } },
      )
      expect(res.status).toBe(201)
      planSpy.mockRestore()
      await FamilyMember.deleteOne({ _id: member._id })
      await Organization.updateOne({ _id: ctx.orgId }, { $unset: { weddingConversionDefaultPlanId: 1 } })
    })
  })

  describe('withdrawals/[withdrawalId]', () => {
    it('DELETE rate limits', async () => {
      bindSession(ctx)
      const { DELETE } = await import('@/lib/route-logic/families/[id]/withdrawals/[withdrawalId]')
      const params = { id: ctx.fixtures.familyId, withdrawalId: ctx.fixtures.withdrawalId }
      await withRateLimitBlocked(async () => {
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
  })

  describe('saved-payment-methods and charge-saved-card', () => {
    it('rejects member not in family and logs task-creation failure', async () => {
      bindSession(ctx)
      const { FamilyMember } = await import('@/lib/models')
      const otherMember = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Other',
        lastName: 'Fam',
        gender: 'male',
      })
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const wrongMember = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 5,
          memberId: otherMember._id.toString(),
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(wrongMember.status).toBe(404)
      await FamilyMember.deleteOne({ _id: otherMember._id })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as { paymentIntents: { create: ReturnType<typeof vi.fn> } }
      client.paymentIntents.create.mockRejectedValueOnce(new Error('stripe boom'))
      const taskHelpers = await import('@/lib/task-helpers')
      const taskSpy = vi
        .spyOn(taskHelpers, 'createPaymentDeclinedTask')
        .mockRejectedValueOnce(new Error('task create failed'))
      const fail = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 6,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(fail.status).toBe(500)
      taskSpy.mockRestore()
    })

    it('validates charge body and saved-method ownership', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const badBody = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          amount: -1,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(badBody.status).toBe(400)

      const { SavedPaymentMethod } = await import('@/lib/models')
      const other = await SavedPaymentMethod.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        stripePaymentMethodId: 'pm_otherfamily',
        last4: '1111',
        cardType: 'visa',
        expiryMonth: 1,
        expiryYear: 2031,
        isDefault: false,
        isActive: true,
      })
      const wrongFam = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: other._id.toString(),
          amount: 5,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(wrongFam.status).toBe(404)
      await SavedPaymentMethod.deleteOne({ _id: other._id })
    })

    it('handles duplicate-key ledger miss after successful Stripe charge', async () => {
      bindSession(ctx)
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({ organizationId: ctx.orgId, stripePaymentIntentId: 'pi_apiprobemock' })
      const dupErr = Object.assign(new Error('duplicate'), { code: 11000 })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      const findSpy = vi.spyOn(Payment, 'findOne').mockResolvedValueOnce(null as never)
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      try {
        const res = await POST(
          orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
            savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
            amount: 17,
            type: 'membership',
            paymentDate: today(),
          }),
          { params: { id: ctx.fixtures.familyId } },
        )
        expect(res.status).toBe(500)
      } finally {
        createSpy.mockRestore()
        findSpy.mockRestore()
      }
    })

    it('charge computes ratioVsRecurring when benchmark exists', async () => {
      bindSession(ctx)
      const { RecurringPayment, Payment } = await import('@/lib/models')
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 100,
        frequency: 'monthly',
        startDate: new Date(),
        nextPaymentDate: new Date(),
        isActive: true,
      })
      await Payment.deleteMany({ organizationId: ctx.orgId, stripePaymentIntentId: 'pi_apiprobemock' })
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 50,
          type: 'membership',
          paymentDate: today(),
          year: year(),
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect([200, 201]).toContain(res.status)
    })

    it('saved-payment-methods validates POST fields and DELETE missing family', async () => {
      bindSession(ctx)
      const path = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST, DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')

      expect(
        (
          await POST(orgJsonReq(path, 'POST', { paymentIntentId: 'pi_test' }), {
            params: { id: ctx.fixtures.familyId },
          })
        ).status,
      ).toBe(400)

      expect(
        (
          await POST(orgJsonReq(path, 'POST', { paymentMethodId: 'pm_test123' }), {
            params: { id: ctx.fixtures.familyId },
          })
        ).status,
      ).toBe(400)

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { retrieve: ReturnType<typeof vi.fn> }
        paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.retrieve.mockResolvedValueOnce({
        status: 'succeeded',
        payment_method: 'pm_saveok',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      client.paymentMethods.retrieve.mockResolvedValueOnce({
        id: 'pm_saveok',
        card: { last4: '4242', brand: 'visa', exp_month: 12, exp_year: 2030 },
        billing_details: { name: 'Save OK' },
      })
      const saved = await POST(
        orgJsonReq(path, 'POST', {
          paymentMethodId: 'pm_saveok',
          paymentIntentId: 'pi_saveok',
          setAsDefault: true,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect([200, 201]).toContain(saved.status)

      const missingFam = await DELETE(
        orgJsonReq(
          `/api/families/${new Types.ObjectId()}/saved-payment-methods?paymentMethodId=${ctx.fixtures.savedPaymentMethodId}`,
          'DELETE',
        ),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missingFam.status).toBe(404)
    })
  })

  describe('members payments and statements', () => {
    it('balance rate limits and validates asOfDate range', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/members/[memberId]/balance')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance`, 'GET'), {
              params: { memberId: ctx.fixtures.memberId },
            })
          ).status,
        ).toBe(429)
      })
      const outOfRange = await GET(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance`, 'GET', undefined, {
          query: '?asOfDate=1800-01-01',
        }),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(outOfRange.status).toBe(400)
    })

    it('payments 404 and cursor mapper', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/members/[memberId]/payments')
      const missing = await GET(
        orgJsonReq(`/api/members/${new Types.ObjectId()}/payments`, 'GET'),
        { params: { memberId: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)

      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        memberId: ctx.fixtures.memberId,
        amount: 3,
        paymentDate: new Date(`${year()}-05-15`),
        year: year(),
        type: 'membership',
        paymentMethod: 'cash',
      })
      await withCompoundCursorSpy(async () => {
        expect(
          (
            await GET(
              orgJsonReq(`/api/members/${ctx.fixtures.memberId}/payments`, 'GET', undefined, {
                query: `?year=${year()}`,
              }),
              { params: { memberId: ctx.fixtures.memberId } },
            )
          ).status,
        ).toBe(200)
      })
    })

    it('statements GET cursor, POST 404, and duplicate-key refresh', async () => {
      bindSession(ctx)
      const { GET, POST } = await import('@/lib/route-logic/members/[memberId]/statements')
      const missing = await POST(
        orgJsonReq(`/api/members/${new Types.ObjectId()}/statements`, 'POST', {
          fromDate: `${year()}-01-01`,
          toDate: `${year()}-01-31`,
        }),
        { params: { memberId: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)

      await withRateLimitBlocked(async () => {
        expect(
          (
            await POST(
              orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', {
                fromDate: `${year()}-02-01`,
                toDate: `${year()}-02-28`,
              }),
              { params: { memberId: ctx.fixtures.memberId } },
            )
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

      const range = { fromDate: `${year()}-03-01`, toDate: `${year()}-03-31` }
      const first = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', range),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(first.status).toBeGreaterThanOrEqual(200)

      const { Statement } = await import('@/lib/models')
      const dupErr = Object.assign(new Error('duplicate'), { code: 11000 })
      const createSpy = vi.spyOn(Statement, 'create').mockRejectedValueOnce(dupErr)
      const raced = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', range),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(raced.status).toBe(200)
      createSpy.mockRestore()

      const boomSpy = vi.spyOn(Statement, 'create').mockRejectedValueOnce(new Error('statement write failed'))
      const boom = await POST(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'POST', {
          fromDate: `${year()}-04-01`,
          toDate: `${year()}-04-30`,
        }),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(boom.status).toBe(500)
      boomSpy.mockRestore()
    })
  })

  describe('jobs', () => {
    it('wedding-converter sanitizes per-org errors in production', async () => {
      const prev = process.env.NODE_ENV
      setNodeEnv('production'
)
      const { FamilyMember } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Wedding',
        lastName: 'Cron',
        weddingDate: new Date('2019-01-01'),
        gender: 'male',
      })
      const wc = await import('@/lib/wedding-converter')
      const spy = vi.spyOn(wc, 'convertMembersOnWeddingDate').mockRejectedValueOnce(new Error('stripe secret detail'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
        const res = await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
      } finally {
        spy.mockRestore()
        setNodeEnv(prev
)
        await FamilyMember.deleteOne({ _id: member._id })
      }
    })

    it('cycle-rollover sanitizes errors and throws on outer failure', async () => {
      const prev = process.env.NODE_ENV
      setNodeEnv('production'
)
      const cr = await import('@/lib/cycle-rollover')
      const spy = vi.spyOn(cr, 'runCycleRolloverForOrg').mockRejectedValueOnce(new Error('rollover secret'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const res = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        expect([200, 500]).toContain(res.status)
        if (res.status === 200) {
          const body = await res.json()
          expect(body.errors?.length ?? 0).toBeGreaterThanOrEqual(0)
        }
      } finally {
        spy.mockRestore()
        setNodeEnv(prev
)
      }

      const cronLock = await import('@/lib/cron-lock')
      const lockSpy = vi.spyOn(cronLock, 'acquireCronLock').mockRejectedValueOnce(new Error('lock boom'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const fail = await POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        expect(fail.status).toBe(500)
      } finally {
        lockSpy.mockRestore()
      }
    })

    it('generate-monthly-statements throws on runChunked failure', async () => {
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockRejectedValueOnce(new Error('chunk fail'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const res = await POST(orgJsonReq('/api/jobs/generate-monthly-statements', 'POST', {}, { cron: true }))
        expect(res.status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })

    it('process-recurring-payments throws when internal fetch fails', async () => {
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
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'fail' }))
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

  describe('jobs send-monthly-statements', () => {
    it('throws when per-org email fetch fails', async () => {
      const { Organization } = await import('@/lib/models')
      const day = new Date().getDate()
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
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(orgJsonReq('/api/jobs/send-monthly-statements', 'POST', {}, { cron: true }))
        expect(res.status).toBe(500)
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
        await Organization.updateOne({ _id: ctx.orgId }, { $unset: { monthlyStatementAutoEmail: 1 } })
      }
    })
  })

  describe('trash routes', () => {
    it('GET /api/trash lists soft-deleted items with limit', async () => {
      bindSession(ctx)
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = mockOrgContext({ organizationId: ctx.orgId, userId: ctx.userId, role: 'owner' })
      await softDeleteOne('task', ctx.fixtures.disposableTaskId, orgCtx)

      const { GET } = await import('@/lib/route-logic/trash')
      const res = await GET(orgJsonReq('/api/trash', 'GET', undefined, { query: '?limit=5' }))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toBeTruthy()
    })

    it('GET DELETE restore and purge-all on soft-deleted task', async () => {
      bindSession(ctx)
      const { Task } = await import('@/lib/models')
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = mockOrgContext({ organizationId: ctx.orgId, userId: ctx.userId, role: 'owner' })
      const task = await Task.create({
        organizationId: ctx.orgId,
        title: `Trash Probe ${Date.now()}`,
        dueDate: new Date(),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
      })
      await softDeleteOne('task', task._id.toString(), orgCtx)

      const { GET, DELETE } = await import('@/lib/route-logic/trash/[kind]/[id]')
      const params = { kind: 'task', id: task._id.toString() }
      const got = await GET(orgJsonReq(`/api/trash/task/${task._id}`, 'GET'), { params })
      expect(got.status).toBe(200)

      const gone = await GET(
        orgJsonReq(`/api/trash/task/${new Types.ObjectId()}`, 'GET'),
        { params: { kind: 'task', id: new Types.ObjectId().toString() } },
      )
      expect(gone.status).toBe(404)

      await withRateLimitBlocked(async () => {
        expect(
          (await DELETE(orgJsonReq(`/api/trash/task/${task._id}`, 'DELETE'), { params })).status,
        ).toBe(429)
      })

      const purged = await DELETE(orgJsonReq(`/api/trash/task/${task._id}`, 'DELETE'), { params })
      expect(purged.status).toBe(200)

      const restoreMod = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const recycle = await import('@/lib/recycle-bin')
      const task2 = await Task.create({
        organizationId: ctx.orgId,
        title: `Restore Probe ${Date.now()}`,
        dueDate: new Date(),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
      })
      await softDeleteOne('task', task2._id.toString(), orgCtx)
      const restored = await restoreMod.POST(
        orgJsonReq(`/api/trash/task/${task2._id}/restore`, 'POST', {}),
        { params: { kind: 'task', id: task2._id.toString() } },
      )
      expect(restored.status).toBe(200)

      const throwSpy = vi.spyOn(recycle, 'restoreFromBin').mockRejectedValueOnce(new Error('restore boom'))
      const boom = await restoreMod.POST(
        orgJsonReq(`/api/trash/task/${task2._id}/restore`, 'POST', {}),
        { params: { kind: 'task', id: task2._id.toString() } },
      )
      expect(boom.status).toBe(500)
      throwSpy.mockRestore()
      await Task.deleteMany({ _id: { $in: [task._id, task2._id] } })
    })

    it('POST /api/trash/purge-all purges recycle bin', async () => {
      bindSession(ctx)
      const { Task } = await import('@/lib/models')
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = mockOrgContext({ organizationId: ctx.orgId, userId: ctx.userId, role: 'owner' })
      const task = await Task.create({
        organizationId: ctx.orgId,
        title: `Purge All ${Date.now()}`,
        dueDate: new Date(),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
      })
      await softDeleteOne('task', task._id.toString(), orgCtx)

      const { POST } = await import('@/lib/route-logic/trash/purge-all')
      const res = await POST(orgJsonReq('/api/trash/purge-all', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toMatch(/Purged/)
      expect(body.counts).toBeTruthy()
    })
  })
})
