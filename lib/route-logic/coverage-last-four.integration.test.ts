/**
 * Final four lib/route-logic files below 100% line coverage.
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

async function seedEmailConfig(orgId = ctx.orgId) {
  const enc = await import('@/lib/encryption')
  const { EmailConfig } = await import('@/lib/models')
  await EmailConfig.updateOne(
    { organizationId: orgId },
    {
      $set: {
        email: 'last-four@example.com',
        password: enc.encrypt('app-password'),
        fromName: 'Last Four',
        isActive: true,
      },
    },
    { upsert: true },
  )
}

describe.sequential('route-logic last four coverage gaps', () => {
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

  it('convert-to-family logs default plan lookup failures', async () => {
    bindSession(ctx)
    const { FamilyMember, Organization, PaymentPlan, Family } = await import('@/lib/models')
    const member = await FamilyMember.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      firstName: 'Last',
      lastName: 'Four',
      gender: 'male',
    })
    await Organization.updateOne(
      { _id: ctx.orgId },
      { $set: { weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId } },
    )
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const planSpy = vi.spyOn(PaymentPlan, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockRejectedValue(new Error('plan lookup failed')),
      }),
    } as never)
    const { POST } = await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
    const res = await POST(
      orgJsonReq(
        `/api/families/${ctx.fixtures.familyId}/members/${member._id}/convert-to-family`,
        'POST',
        { weddingDate: '2025-10-01' },
      ),
      { params: { id: ctx.fixtures.familyId, memberId: member._id.toString() } },
    )
    expect(res.status).toBe(201)
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error resolving wedding-conversion default plan:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
    planSpy.mockRestore()
    const created = await Family.findOne({ parentFamilyId: ctx.fixtures.familyId, name: /Last Four/ })
    if (created) await Family.deleteOne({ _id: created._id })
    await FamilyMember.deleteOne({ _id: member._id })
    await Organization.updateOne({ _id: ctx.orgId }, { $unset: { weddingConversionDefaultPlanId: 1 } })
  })

  it('tax-receipts worker logs continuation HTTP errors', async () => {
    await seedEmailConfig()
    const { Family, EmailJob } = await import('@/lib/models')
    const taxMod = await import('@/lib/tax-receipts/send-receipt')
    const sendSpy = vi.spyOn(taxMod, 'sendOneFamilyTaxReceipt').mockResolvedValue({ ok: true, email: null })
    const logMod = await import('@/lib/log')
    const logSpy = vi.spyOn(logMod, 'logError').mockImplementation(() => {})
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      const ids = await Promise.all(
        [0, 1, 2, 3].map((i) =>
          Family.create({
            organizationId: ctx.orgId,
            name: `Tax Last4 ${i} ${Date.now()}`,
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
      })
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      await new Promise((r) => setTimeout(r, 80))
      expect(fetchSpy).toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('continuation HTTP 502') }),
        expect.objectContaining({ phase: 'continuation' }),
      )
      await EmailJob.deleteOne({ _id: job._id })
      await Family.deleteMany({ _id: { $in: ids.map((f) => f._id) } })
    } finally {
      sendSpy.mockRestore()
      logSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

})
