/**
 * Payments / Stripe / import domain — final lib/route-logic line coverage.
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

function webhookReq(event: { id: string; type: string; data: unknown }): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
}

async function stripeTestClient() {
  const Stripe = (await import('stripe')).default
  return new Stripe('sk_test') as unknown as {
    webhooks: { constructEvent: ReturnType<typeof vi.fn> }
    paymentIntents: {
      retrieve: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
    }
    paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
    charges: { retrieve: ReturnType<typeof vi.fn> }
  }
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

describe.sequential('route-logic payments domain coverage', () => {
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

  describe('import.ts remaining branches', () => {
    it('parseCSV opens quoted fields and imports payment by family name with memberId', async () => {
      bindSession(ctx)
      const { parseCSV, POST } = await import('@/lib/route-logic/import')
      const { headers, rows } = parseCSV('col1,col2\n"quoted",plain\n')
      expect(headers).toEqual(['col1', 'col2'])
      expect(rows[0][0]).toBe('quoted')

      const { Family, FamilyMember } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const member = await FamilyMember.findById(ctx.fixtures.memberId).select('_id')

      const ok = await POST(
        importReq(
          importForm(
            'payments',
            `familyName,amount,paymentDate,memberId\n${fam?.name},25.00,2024-07-01,${member?._id}`,
            'pay-by-name-member.csv',
          ),
        ),
      )
      expect(ok.status).toBe(200)
      const body = await ok.json()
      expect(body.imported).toBeGreaterThanOrEqual(1)

      const notFound = await POST(
        importReq(
          importForm(
            'payments',
            'familyName,amount,paymentDate\nNoSuchFamily,10,2024-07-01',
            'pay-missing-family.csv',
          ),
        ),
      )
      expect((await notFound.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('import payment reports member not found in family', async () => {
      bindSession(ctx)
      const { Family, FamilyMember } = await import('@/lib/models')
      const fam = await Family.findById(ctx.fixtures.familyId).select('name')
      const stray = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Stray',
        lastName: 'Pay',
      })
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(
        importReq(
          importForm(
            'payments',
            `familyName,amount,paymentDate,memberId\n${fam?.name},10,2024-07-01,${stray._id}`,
            'pay-stray-member.csv',
          ),
        ),
      )
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
      await FamilyMember.deleteOne({ _id: stray._id })
    })

    it('parseCSV handles bare carriage returns and parseDate rejects invalid ISO days', async () => {
      const { parseCSV, parseDate, POST } = await import('@/lib/route-logic/import')
      const { rows } = parseCSV('a,b\rc,d\n')
      expect(rows[0]).toEqual(['c', 'd'])
      expect(parseDate('2024-13-40')).toBeNull()
      expect(parseDate('January 1, 3000')).toBeNull()
      expect(parseDate('June 15, 2020')?.getFullYear()).toBe(2020)

      bindSession(ctx)
      const ExcelJS = await import('exceljs')
      const mod = ExcelJS.default ?? ExcelJS
      const wb = new mod.Workbook()
      const ws = wb.addWorksheet('Sheet1')
      wb.removeWorksheet(ws.id)
      const buf = await wb.xlsx.writeBuffer()
      const form = new FormData()
      form.set('type', 'families')
      form.set(
        'file',
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        'empty.xlsx',
      )
      const emptyXlsx = await POST(importReq(form))
      expect(emptyXlsx.status).toBe(400)

      const wb2 = new mod.Workbook()
      const ws2 = wb2.addWorksheet('Payments')
      ws2.addRow(['familyName', 'amount', 'paymentDate'])
      const fam = await (await import('@/lib/models')).Family.findById(ctx.fixtures.familyId).select('name')
      ws2.addRow([fam?.name ?? 'Family', '15', '2024-08-01'])
      const buf2 = await wb2.xlsx.writeBuffer()
      const xlsxForm = new FormData()
      xlsxForm.set('type', 'payments')
      xlsxForm.set(
        'file',
        new Blob([buf2], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        'payments.xlsx',
      )
      const xlsxRes = await POST(importReq(xlsxForm))
      expect(xlsxRes.status).toBe(200)

      const invalidPlan = await POST(
        importReq(
          importForm(
            'families',
            `name,weddingDate,paymentPlanId\nPlanBadId${Date.now()},2018-02-01,not-a-valid-plan-id`,
            'bad-plan-id.csv',
          ),
        ),
      )
      expect((await invalidPlan.json()).warnings?.length).toBeGreaterThan(0)

      const { PaymentPlan } = await import('@/lib/models')
      const foreignPlan = await PaymentPlan.create({
        organizationId: ctx.betaOrgId,
        name: `Foreign Plan ${Date.now()}`,
        planNumber: 88,
        yearlyPrice: 50,
      })
      const foreignRes = await POST(
        importReq(
          importForm(
            'families',
            `name,weddingDate,paymentPlanId\nPlanForeign${Date.now()},2018-02-01,${foreignPlan._id}`,
            'foreign-plan.csv',
          ),
        ),
      )
      expect((await foreignRes.json()).warnings?.length).toBeGreaterThan(0)
      await PaymentPlan.deleteOne({ _id: foreignPlan._id })
    })

    it('returns 429 when import is rate limited', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      await withRateLimitBlocked(async () => {
        expect(
          (await POST(importReq(importForm('families', 'name,weddingDate\nRL,2019-01-01', 'rl.csv')))).status,
        ).toBe(429)
      })
    })
  })

  describe('stripe/webhook.ts remaining branches', () => {
    it('clears refundedAt when Stripe charge refund total drops to zero', async () => {
      bindSession(ctx)
      const piId = `pi_refundzero${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 80,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        refundedAmount: 40,
        refundedAt: new Date(),
      })

      const client = await stripeTestClient()
      vi.mocked(client.charges.retrieve).mockResolvedValueOnce({
        id: 'ch_refund_zero',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })
      vi.mocked(client.webhooks.constructEvent).mockReturnValueOnce({
        id: `evt_refund_zero_${Date.now()}`,
        type: 'charge.dispute.closed',
        data: {
          object: {
            id: 'dp_refund_zero',
            charge: 'ch_refund_zero',
            status: 'won',
            payment_intent: piId,
          },
        },
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(webhookReq({ id: 'evt', type: 'charge.dispute.closed', data: {} }))
      expect(res.status).toBe(200)

      const updated = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(Number(updated?.refundedAmount || 0)).toBe(0)
      expect(updated?.refundedAt).toBeUndefined()
      await Payment.deleteMany({ stripePaymentIntentId: piId })
    })
  })

  describe('stripe/create-payment-intent.ts remaining branches', () => {
    it('rejects invalid familyId and tolerates audit failure with ratioVsRecurring', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
      const badFam = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: 'not-valid',
          amount: 10,
        }),
      )
      expect(badFam.status).toBe(400)

      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.updateOne(
        { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId, isActive: true },
        { $set: { amount: 50 } },
        { upsert: true },
      )

      const auditMod = await import('@/lib/audit')
      const auditSpy = vi.spyOn(auditMod, 'audit').mockRejectedValueOnce(new Error('audit miss'))
      const res = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 55,
          idempotencyHint: `ratio-${Date.now()}`,
        }),
      )
      expect(res.status).toBe(200)
      auditSpy.mockRestore()
    })
  })

  describe('stripe/confirm-payment.ts remaining branches', () => {
    it('recovers from duplicate-key race on Payment.create', async () => {
      bindSession(ctx)
      const piId = `pi_raceok${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      const raced = {
        _id: new Types.ObjectId(),
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 44,
        stripePaymentIntentId: piId,
        recurringPaymentId: undefined,
      }

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 4400,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: String(ctx.orgId), familyId: String(ctx.fixtures.familyId) },
      })

      const dupErr = Object.assign(new Error('dup'), { code: 11000 })
      const findOrig = Payment.findOne.bind(Payment)
      let includeDeletedHits = 0
      const findSpy = vi.spyOn(Payment, 'findOne').mockImplementation((filter: unknown, proj?: unknown, opts?: unknown) => {
        const f = filter as { stripePaymentIntentId?: string; organizationId?: string; _id?: unknown }
        if (
          f?.stripePaymentIntentId === piId &&
          f?.organizationId === ctx.orgId &&
          opts &&
          typeof opts === 'object' &&
          'includeDeleted' in opts
        ) {
          includeDeletedHits += 1
          if (includeDeletedHits >= 2) return Promise.resolve(raced as never)
          return Promise.resolve(null)
        }
        if (f?._id) {
          return {
            select: () => ({
              lean: async () => ({ amount: 44, _id: raced._id }),
            }),
          } as never
        }
        return findOrig(filter as never, proj as never, opts as never)
      })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piId,
          familyId: ctx.fixtures.familyId,
          year: year(),
        }),
      )
      expect(res.status).toBe(200)
      createSpy.mockRestore()
      findSpy.mockRestore()
    })

    it('returns 404 for unknown saved payment method and logs will_be_saved failures', async () => {
      bindSession(ctx)
      const piId = `pi_spmmiss${Date.now()}`
      const { Payment, SavedPaymentMethod } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 1200,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const missingSpm = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piId,
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: new Types.ObjectId().toString(),
        }),
      )
      expect(missingSpm.status).toBe(404)

      const piSave = `pi_savefail${Date.now()}`
      await Payment.deleteMany({ stripePaymentIntentId: piSave })
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piSave,
        status: 'succeeded',
        amount: 1500,
        currency: 'usd',
        payment_method: 'pm_savefail01',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      vi.mocked(client.paymentMethods.retrieve).mockResolvedValueOnce({
        id: 'pm_savefail01',
        card: { last4: '1111', brand: 'visa', exp_month: 1, exp_year: 2030 },
        billing_details: { name: 'Fail Save' },
      })
      const createSpmSpy = vi.spyOn(SavedPaymentMethod, 'create').mockRejectedValueOnce(new Error('spm db fail'))
      const saveFail = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piSave,
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: 'will_be_saved',
        }),
      )
      expect(saveFail.status).toBe(200)
      createSpmSpy.mockRestore()
    })

    it('returns 500 when payment row disappears after create', async () => {
      bindSession(ctx)
      const piId = `pi_missingrow${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 2100,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const findOrig = Payment.findOne.bind(Payment)
      const findSpy = vi.spyOn(Payment, 'findOne').mockImplementation((filter: unknown, _p?: unknown, opts?: unknown) => {
        const f = filter as { _id?: unknown; stripePaymentIntentId?: string }
        if (f?._id && !(opts && typeof opts === 'object' && 'includeDeleted' in opts)) {
          return { select: () => ({ lean: async () => null }) } as never
        }
        return findOrig(filter as never, _p as never, opts as never)
      })

      try {
        const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
        const res = await POST(
          orgJsonReq('/api/stripe/confirm-payment', 'POST', {
            paymentIntentId: piId,
            familyId: ctx.fixtures.familyId,
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        findSpy.mockRestore()
      }
    })

    it('falls back when org timezone lookup fails', async () => {
      bindSession(ctx)
      const piId = `pi_orgtzfail${Date.now()}`
      const { Payment, Organization } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })

      const findOrig = Organization.findById.bind(Organization)
      const orgSpy = vi.spyOn(Organization, 'findById').mockImplementation((id: unknown) => {
        const query = findOrig(id as never)
        const origSelect = query.select.bind(query)
        ;(query as { select: typeof query.select }).select = ((
          fields?: string | string[] | Record<string, number | boolean | object>,
        ) => {
          if (fields === 'timezone') {
            return { lean: () => Promise.reject(new Error('org lookup failed')) } as never
          }
          return origSelect(fields as never)
        }) as typeof query.select
        return query
      })

      try {
        const client = await stripeTestClient()
        vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
          id: piId,
          status: 'succeeded',
          amount: 1800,
          currency: 'usd',
          metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
        })

        const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
        const res = await POST(
          orgJsonReq('/api/stripe/confirm-payment', 'POST', {
            paymentIntentId: piId,
            familyId: ctx.fixtures.familyId,
          }),
        )
        expect(res.status).toBe(200)
      } finally {
        orgSpy.mockRestore()
      }
    })
  })

  describe('recurring-payments/process.ts remaining branches', () => {
    it('recovers ledger row on duplicate key insert', async () => {
      bindSession(ctx)
      const due = new Date()
      due.setDate(due.getDate() - 1)
      const piId = `pi_recurringdup${Date.now()}`
      const { RecurringPayment, Payment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 19,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.create).mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 1900,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const dupErr = Object.assign(new Error('dup'), { code: 11000 })
      const raced = {
        _id: new Types.ObjectId(),
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 19,
        stripePaymentIntentId: piId,
      }
      const findOrig = Payment.findOne.bind(Payment)
      let includeDeletedHits = 0
      const findSpy = vi.spyOn(Payment, 'findOne').mockImplementation((filter: unknown, _p?: unknown, opts?: unknown) => {
        const f = filter as { stripePaymentIntentId?: string }
        if (f?.stripePaymentIntentId === piId && opts && typeof opts === 'object' && 'includeDeleted' in opts) {
          includeDeletedHits += 1
          if (includeDeletedHits >= 2) return Promise.resolve(raced as never)
          return Promise.resolve(null)
        }
        return findOrig(filter as never, _p as never, opts as never)
      })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)

      try {
        const { POST } = await import('@/lib/route-logic/recurring-payments/process')
        const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        expect(res.status).toBe(200)
        expect((await res.json()).processed).toBeGreaterThanOrEqual(1)
      } finally {
        createSpy.mockRestore()
        findSpy.mockRestore()
      }
    })

    it('paginates due recurring rows when a full page is returned', async () => {
      bindSession(ctx)
      const schemas = await import('@/lib/schemas')
      const capSpy = vi.spyOn(schemas, 'UNBOUNDED_LIST_CAP', 'get').mockReturnValue(1 as never)
      const due = new Date()
      due.setDate(due.getDate() - 1)
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      const rows = await RecurringPayment.create([
        {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 11,
          frequency: 'monthly',
          startDate: due,
          nextPaymentDate: due,
          isActive: true,
        },
        {
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 12,
          frequency: 'monthly',
          startDate: due,
          nextPaymentDate: due,
          isActive: true,
        },
      ])

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.create)
        .mockResolvedValueOnce({
          id: 'pi_recurringpage1',
          status: 'succeeded',
          amount: 1100,
          currency: 'usd',
          payment_method: 'pm_probemock',
        })
        .mockResolvedValueOnce({
          id: 'pi_recurringpage2',
          status: 'succeeded',
          amount: 1200,
          currency: 'usd',
          payment_method: 'pm_probemock',
        })

      try {
        const { POST } = await import('@/lib/route-logic/recurring-payments/process')
        const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        expect(res.status).toBe(200)
      } finally {
        capSpy.mockRestore()
        await RecurringPayment.deleteMany({ _id: { $in: rows.map((r) => r._id) } })
      }
    })

    it('skips claim when another worker already advanced the schedule', async () => {
      bindSession(ctx)
      const due = new Date()
      due.setDate(due.getDate() - 1)
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 13,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })
      const origUpdate = RecurringPayment.updateOne.bind(RecurringPayment)
      vi.spyOn(RecurringPayment, 'updateOne').mockImplementation(async (filter: unknown, update: unknown) => {
        if (filter && typeof filter === 'object' && 'nextPaymentDate' in (filter as object)) {
          return { acknowledged: true, modifiedCount: 0, matchedCount: 1, upsertedCount: 0, upsertedId: null }
        }
        return origUpdate(filter as never, update as never)
      })
      try {
        const { POST } = await import('@/lib/route-logic/recurring-payments/process')
        const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        expect(res.status).toBe(200)
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('records stripe-not-configured when secret key is missing', async () => {
      bindSession(ctx)
      const prev = process.env.STRIPE_SECRET_KEY
      const due = new Date()
      due.setDate(due.getDate() - 1)
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.updateMany(
        { organizationId: ctx.orgId },
        { $set: { nextPaymentDate: due, isActive: true } },
      )
      try {
        delete process.env.STRIPE_SECRET_KEY
        const { POST } = await import('@/lib/route-logic/recurring-payments/process')
        const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
      } finally {
        process.env.STRIPE_SECRET_KEY = prev ?? 'sk_test'
      }
    })

    it('GET list exercises compound cursor mapper', async () => {
      bindSession(ctx)
      const { RecurringPayment } = await import('@/lib/models')
      const next = new Date()
      next.setMonth(next.getMonth() + 2)
      await RecurringPayment.updateOne(
        { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
        { $set: { isActive: true, nextPaymentDate: next } },
        { upsert: true },
      )

      const pag = await import('@/lib/pagination')
      const spy = vi.spyOn(pag, 'collectCompoundCursorPages').mockImplementation(
        async (loadPage, baseFilter, _sf, _dir, getCursor, _bs) => {
          const page = await loadPage(baseFilter, 2)
          if (page[0]) getCursor(page[0] as never)
          return page
        },
      )
      try {
        const { GET } = await import('@/lib/route-logic/recurring-payments/process')
        const res = await GET(
          orgJsonReq('/api/recurring-payments/process', 'GET', undefined, {
            query: `?familyId=${ctx.fixtures.familyId}&activeOnly=false`,
          }),
        )
        expect(res.status).toBe(200)
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('families/[id]/charge-saved-card.ts remaining branches', () => {
    it('rejects wrong-family saved method and invalid memberId format', async () => {
      bindSession(ctx)
      const { SavedPaymentMethod } = await import('@/lib/models')
      const otherSpm = await SavedPaymentMethod.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        stripePaymentMethodId: 'pm_otherfamily',
        last4: '9999',
        cardType: 'visa',
        expiryMonth: 1,
        expiryYear: 2030,
        isDefault: false,
        isActive: true,
      })

      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const wrongFam = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: otherSpm._id.toString(),
          amount: 5,
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(wrongFam.status).toBe(404)

      const badMember = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 5,
          memberId: 'not-valid',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(badMember.status).toBe(400)
      await SavedPaymentMethod.deleteOne({ _id: otherSpm._id })
    })

    it('records ratioVsRecurring on successful charge', async () => {
      bindSession(ctx)
      const { RecurringPayment, Payment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId, familyId: ctx.fixtures.familyId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 40,
        frequency: 'monthly',
        startDate: new Date(),
        nextPaymentDate: new Date(),
        isActive: true,
      })
      await Payment.deleteMany({ organizationId: ctx.orgId, stripePaymentIntentId: 'pi_ratiocharge1' })

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.create).mockResolvedValueOnce({
        id: 'pi_ratiocharge1',
        status: 'succeeded',
        amount: 6000,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 60,
          paymentDate: today(),
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(200)
    })
  })

  describe('families/[id]/saved-payment-methods.ts remaining branches', () => {
    it('validates payment method id format and requires paymentIntentId', async () => {
      bindSession(ctx)
      const path = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')

      const badPm = await POST(
        orgJsonReq(path, 'POST', { paymentMethodId: 'bad-id' }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(badPm.status).toBe(400)

      const noPi = await POST(
        orgJsonReq(path, 'POST', { paymentMethodId: 'pm_test123' }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(noPi.status).toBe(400)
    })

    it('DELETE returns 404 for missing family', async () => {
      bindSession(ctx)
      const missingId = new Types.ObjectId().toString()
      const { DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const res = await DELETE(
        orgJsonReq(
          `/api/families/${missingId}/saved-payment-methods?paymentMethodId=${ctx.fixtures.savedPaymentMethodId}`,
          'DELETE',
        ),
        { params: { id: missingId } },
      )
      expect(res.status).toBe(404)
    })

    it('saves a new card after PI verification', async () => {
      bindSession(ctx)
      const pmId = 'pm_domaincover01'
      const piId = 'pi_domaincover01'
      const { SavedPaymentMethod } = await import('@/lib/models')
      await SavedPaymentMethod.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentMethodId: pmId,
      })

      try {
        const client = await stripeTestClient()
        vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
          id: piId,
          status: 'succeeded',
          payment_method: pmId,
          metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
        })
        vi.mocked(client.paymentMethods.retrieve).mockResolvedValueOnce({
          id: pmId,
          card: { last4: '4242', brand: 'visa', exp_month: 12, exp_year: 2030 },
          billing_details: { name: 'Domain Cover' },
        })

        const path = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
        const { POST } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
        const res = await POST(
          orgJsonReq(path, 'POST', {
            paymentMethodId: pmId,
            paymentIntentId: piId,
            setAsDefault: true,
          }),
          { params: { id: ctx.fixtures.familyId } },
        )
        expect(res.status).toBe(201)
      } finally {
        vi.clearAllMocks()
      }
    })
  })
})
