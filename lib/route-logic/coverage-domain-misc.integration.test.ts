/**
 * Auth / organizations / reports / tasks / admin / user — lib/route-logic line coverage.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'
import { generateTotpCode } from '@/lib/totp'

const mockAuth = vi.hoisted(() => vi.fn())
const mockCookieGet = vi.hoisted(() => vi.fn())

vi.mock('@/app/auth', () => ({ auth: mockAuth }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))

const API_ORIGIN = 'http://localhost:3000'
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

function publicJsonReq(path: string, method: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'content-type': 'application/json',
  }
  return new NextRequest(`${API_ORIGIN}${path}`, {
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

describe.sequential('route-logic auth/org/misc domain coverage', () => {
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

  describe('auth/invite', () => {
    it('PUT hits redundant passwordSchema.safeParse failure branch', async () => {
      const { Invite } = await import('@/lib/models')
      const token = `misc-pw-${Date.now()}`
      await Invite.create({
        organizationId: ctx.orgId,
        email: `misc-pw-${Date.now()}@example.com`,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })
      mockAuth.mockResolvedValueOnce(null as never)
      const common = await import('@/lib/schemas/common')
      const spy = vi.spyOn(common.password, 'safeParse').mockReturnValueOnce({
        success: false,
        error: { issues: [{ message: 'Invalid password' }] },
      } as never)
      const { PUT } = await import('@/lib/route-logic/auth/invite')
      const res = await PUT(
        publicJsonReq('/api/auth/invite', 'PUT', {
          token,
          name: 'Valid Name',
          password: 'ValidPass1!',
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/Invalid password/i)
      spy.mockRestore()
      bindSession(ctx)
      await Invite.deleteMany({ token })
    })
  })

  describe('organizations/branding', () => {
    it('clears logo with empty string, rejects processLogo error, DELETE 429', async () => {
      bindSession(ctx)
      const { Organization } = await import('@/lib/models')
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: { 'branding.logoDataUrl': TINY_PNG_DATA_URL, 'branding.logoUpdatedAt': new Date() },
        },
      )
      const { PUT, DELETE } = await import('@/lib/route-logic/organizations/branding')
      expect(
        (await PUT(orgJsonReq('/api/organizations/branding', 'PUT', { logoDataUrl: '' }))).status,
      ).toBe(200)

      const brandingLib = await import('@/lib/branding')
      const logoSpy = vi
        .spyOn(brandingLib, 'processLogoDataUrl')
        .mockResolvedValueOnce({ error: 'Logo processing failed' })
      const badLogo = await PUT(
        orgJsonReq('/api/organizations/branding', 'PUT', { logoDataUrl: TINY_PNG_DATA_URL }),
      )
      expect(badLogo.status).toBe(400)
      logoSpy.mockRestore()

      await withRateLimitBlocked(async () => {
        expect((await DELETE(orgJsonReq('/api/organizations/branding', 'DELETE'))).status).toBe(429)
      })
    })
  })

  describe('organizations/automation', () => {
    it('rejects invalid bar mitzvah and wedding plan id formats', async () => {
      bindSession(ctx)
      const { PUT } = await import('@/lib/route-logic/organizations/automation')
      expect(
        (
          await PUT(
            orgJsonReq('/api/organizations/automation', 'PUT', {
              barMitzvahAutoAssignPlanId: 'not-valid',
            }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await PUT(
            orgJsonReq('/api/organizations/automation', 'PUT', {
              weddingConversionDefaultPlanId: 'not-valid',
            }),
          )
        ).status,
      ).toBe(400)
    })
  })

  describe('reports/pl', () => {
    it('rejects oversized date range and exercises compound cursor mappers', async () => {
      bindSession(ctx)
      const { Payment, LifecycleEventPayment } = await import('@/lib/models')
      const y = 2019
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 40,
        paymentDate: new Date(`${y}-06-15`),
        year: y,
        type: 'membership',
        paymentMethod: 'cash',
      })
      await LifecycleEventPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        eventType: 'bar_mitzvah',
        amount: 15,
        eventDate: new Date(`${y}-07-01`),
        year: y,
      })

      const { GET } = await import('@/lib/route-logic/reports/pl')
      const tooLong = await GET(
        orgJsonReq('/api/reports/pl', 'GET', undefined, {
          query: '?startDate=2018-01-01&endDate=2020-01-02',
        }),
      )
      expect(tooLong.status).toBe(400)

      await withCompoundCursorSpy(async () => {
        const res = await GET(
          orgJsonReq('/api/reports/pl', 'GET', undefined, {
            query: '?startDate=2019-01-01&endDate=2019-12-31',
          }),
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.summary.paymentCount).toBeGreaterThanOrEqual(1)
        expect(body.summary.eventCount).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('lifecycle-event-types/[id]', () => {
    it('PUT empty body, PUT 404, DELETE when soft delete returns null', async () => {
      bindSession(ctx)
      const { PUT, DELETE } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
      const id = ctx.fixtures.lifecycleEventTypeId
      expect(
        (await PUT(orgJsonReq(`/api/lifecycle-event-types/${id}`, 'PUT', {}), { params: { id } }))
          .status,
      ).toBe(400)

      const missing = new Types.ObjectId().toString()
      expect(
        (
          await PUT(orgJsonReq(`/api/lifecycle-event-types/${missing}`, 'PUT', { name: 'Ghost' }), {
            params: { id: missing },
          })
        ).status,
      ).toBe(404)

      const recycle = await import('@/lib/recycle-bin')
      const spy = vi.spyOn(recycle, 'softDeleteOne').mockResolvedValueOnce(null as never)
      expect(
        (await DELETE(orgJsonReq(`/api/lifecycle-event-types/${id}`, 'DELETE'), { params: { id } }))
          .status,
      ).toBe(404)
      spy.mockRestore()
    })
  })

  describe('payment-plans/[id]', () => {
    it('DELETE 404 when missing and when soft delete returns null', async () => {
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

      const { PaymentPlan } = await import('@/lib/models')
      const plan = await PaymentPlan.create({
        organizationId: ctx.orgId,
        name: `Misc Del ${Date.now()}`,
        planNumber: 9500 + Math.floor(Math.random() * 400),
        yearlyPrice: 1,
      })
      const recycle = await import('@/lib/recycle-bin')
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
  })

  describe('admin/invite-requests', () => {
    it('GET compound cursor mapper and PATCH rejects array body', async () => {
      bindSession(ctx)
      const { InviteRequest } = await import('@/lib/models')
      await InviteRequest.create({
        email: `misc-admin-${Date.now()}@example.com`,
        name: 'Admin List',
        status: 'pending',
      })
      await withCompoundCursorSpy(async () => {
        const { GET } = await import('@/lib/route-logic/admin/invite-requests')
        expect((await GET(orgJsonReq('/api/admin/invite-requests', 'GET'))).status).toBe(200)
      })
      const { PATCH } = await import('@/lib/route-logic/admin/invite-requests')
      const bad = await PATCH(
        orgJsonReq('/api/admin/invite-requests', 'PATCH', [] as unknown as object),
      )
      expect(bad.status).toBe(400)
    })
  })

  describe('tasks', () => {
    it('assertRelatedScoped rejects invalid relatedPaymentId and GET filters by member', async () => {
      bindSession(ctx)
      const { assertRelatedScoped, GET } = await import('@/lib/route-logic/tasks')
      expect(await assertRelatedScoped(ctx.orgId, { relatedPaymentId: 'not-valid' })).toEqual({
        ok: false,
        status: 400,
        error: 'Invalid relatedPaymentId',
      })
      await withCompoundCursorSpy(async () => {
        const ok = await GET(
          orgJsonReq('/api/tasks', 'GET', undefined, {
            query: `?relatedMemberId=${ctx.fixtures.memberId}`,
          }),
        )
        expect(ok.status).toBe(200)
      })
    })
  })

  describe('tasks/send-due-date-emails', () => {
    it('missing config, no tasks due, decrypt failure', async () => {
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
        title: 'Misc Due',
        dueDate: new Date(),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
        emailSent: false,
      })
      const badDecrypt = await POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST'))
      expect(badDecrypt.status).toBe(500)
      await Task.deleteMany({ organizationId: ctx.orgId, title: 'Misc Due' })
    })
  })

  describe('user/2fa', () => {
    it('disable without password hash and decrypt catch on disable totp', async () => {
      const bcrypt = await import('bcryptjs')
      const { User } = await import('@/lib/models')
      const enc = await import('@/lib/encryption')
      const secret = enc.encrypt('JBSWY3DPEHPK3PXP')
      const hash = await bcrypt.hash('ApiRouteTestPass123!', 10)
      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: {
            twoFactorEnabled: true,
            twoFactorSecret: secret,
            twoFactorBackupCodes: [],
            hashedPassword: hash,
          },
        },
      )
      bindSession(ctx)

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const decryptSpy = vi.spyOn(enc, 'decryptTwoFactorSecret').mockImplementationOnce(() => {
        throw new Error('decrypt fail')
      })
      const badTotp = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password: 'ApiRouteTestPass123!',
          code: '123456',
        }),
      )
      expect(badTotp.status).toBe(401)
      decryptSpy.mockRestore()

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
          $set: { hashedPassword: hash, twoFactorEnabled: false },
          $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1 },
        },
      )
      bindSession(ctx)
    })
  })

  describe('user/2fa/setup', () => {
    it('re-enroll decrypt catch and bad authentication code', async () => {
      const bcrypt = await import('bcryptjs')
      const { User } = await import('@/lib/models')
      const enc = await import('@/lib/encryption')
      const secret = enc.encrypt('JBSWY3DPEHPK3PXP')
      const hash = await bcrypt.hash('ApiRouteTestPass123!', 10)
      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: {
            twoFactorEnabled: true,
            twoFactorSecret: secret,
            twoFactorBackupCodes: [],
            hashedPassword: hash,
          },
        },
      )
      bindSession(ctx)

      let { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const needsCode = await POST(
        sessionJsonReq('/api/user/2fa/setup', 'POST', { password: 'ApiRouteTestPass123!' }),
      )
      expect(needsCode.status).toBe(401)
      expect((await needsCode.json()).requiresReauth).toBe(true)

      const decryptSpy = vi.spyOn(enc, 'decryptTwoFactorSecret').mockImplementationOnce(() => {
        throw new Error('decrypt fail')
      })
      vi.resetModules()
      decryptSpy.mockRestore()
      const encFresh = await import('@/lib/encryption')
      const decryptSpyFresh = vi
        .spyOn(encFresh, 'decryptTwoFactorSecret')
        .mockImplementationOnce(() => {
          throw new Error('decrypt fail')
        })
      ;({ POST } = await import('@/lib/route-logic/user/2fa/setup'))
      const decryptFail = await POST(
        sessionJsonReq('/api/user/2fa/setup', 'POST', {
          password: 'ApiRouteTestPass123!',
          code: generateTotpCode('JBSWY3DPEHPK3PXP'),
        }),
      )
      expect(decryptFail.status).toBe(401)
      decryptSpyFresh.mockRestore()

      const badCode = await POST(
        sessionJsonReq('/api/user/2fa/setup', 'POST', {
          password: 'ApiRouteTestPass123!',
          code: '000000',
        }),
      )
      expect(badCode.status).toBe(401)

      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: { twoFactorEnabled: false, hashedPassword: hash },
          $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1 },
        },
      )
      bindSession(ctx)
    })
  })
})
