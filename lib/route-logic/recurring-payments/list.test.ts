import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import connectDB from '@/lib/database'
import { RecurringPayment, SavedPaymentMethod, Task } from '@/lib/models'
import {
  listRecurringPaymentsForOrg,
  validateRecurringFamilyFilter,
} from '@/lib/route-logic/recurring-payments/list'
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

function bindSession(c: ApiTestContext) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      memberships: [{ o: c.orgId, r: 'owner' }],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: c.orgId } : undefined,
  )
}

describe.sequential('recurring-payments list', () => {
  let ctx: ApiTestContext

  beforeAll(async () => {
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  it('validateRecurringFamilyFilter rejects invalid and missing families', async () => {
    const bad = await validateRecurringFamilyFilter(ctx.orgId, 'not-an-id')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.status).toBe(400)

    const missing = await validateRecurringFamilyFilter(ctx.orgId, new Types.ObjectId().toString())
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.status).toBe(404)
  })

  it('lists active recurring payments and builds failed queue for overdue rows', async () => {
    await connectDB()
    const due = new Date()
    due.setDate(due.getDate() - 3)

    const saved = await SavedPaymentMethod.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      stripePaymentMethodId: 'pm_list_test',
      last4: '4242',
      cardType: 'Visa',
      expiryMonth: 12,
      expiryYear: 2030,
      isActive: true,
    })

    const recurring = await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: saved._id,
      amount: 120,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
      notes: 'List test recurring',
    })

    await Task.create({
      organizationId: ctx.orgId,
      title: 'Payment Declined: $120',
      description: 'Payment attempt failed for Test Family. Error: Card was declined',
      dueDate: new Date(),
      email: 'test@example.com',
      status: 'pending',
      priority: 'high',
      relatedFamilyId: ctx.fixtures.familyId,
    })

    const result = await listRecurringPaymentsForOrg(ctx.orgId)
    const row = result.recurringPayments.find((r) => r._id === recurring._id.toString())
    expect(row).toBeTruthy()
    expect(row?.isOverdue).toBe(true)
    expect(row?.lastStatus).toBe('failed')
    expect(row?.lastError).toContain('Card was declined')
    expect(row?.savedPaymentMethod?.last4).toBe('4242')

    expect(result.failedQueue.some((f) => f.recurringPaymentId === recurring._id.toString())).toBe(
      true,
    )

    await RecurringPayment.deleteOne({ _id: recurring._id })
    await SavedPaymentMethod.deleteOne({ _id: saved._id })
    await Task.deleteMany({
      organizationId: ctx.orgId,
      relatedFamilyId: ctx.fixtures.familyId,
      title: /^Payment Declined/,
    })
  })

  it('GET /api/recurring-payments returns list payload', async () => {
    bindSession(ctx)
    const { GET } = await import('@/lib/route-logic/recurring-payments/index')
    const req = new NextRequest('http://localhost:3000/api/recurring-payments', {
      method: 'GET',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-organization-id': ctx.orgId,
      },
    })

    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.recurringPayments)).toBe(true)
    expect(Array.isArray(body.failedQueue)).toBe(true)
  })
})
