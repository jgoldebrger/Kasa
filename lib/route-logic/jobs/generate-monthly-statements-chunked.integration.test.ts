import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn() })),
}))

const API_ORIGIN = 'http://localhost:3000'

function cronJsonReq(
  path: string,
  method: string,
  opts?: { query?: string },
): NextRequest {
  const secret = process.env.CRON_SECRET || 'test-cron-secret'
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-cron-secret': secret,
    authorization: `Bearer ${secret}`,
  }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}${opts?.query || ''}`, { method, headers })
}

describe('generate-monthly-statements family chunking (integration)', () => {
  const ownerId = new mongoose.Types.ObjectId()

  beforeAll(async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, PaymentPlan, Family, Statement, JobRun } = await import('@/lib/models')
    await Promise.all([
      Statement.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
      JobRun.deleteMany({}),
    ])
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  async function seedOrgWithFamilies(count: number) {
    const { Organization, PaymentPlan, Family } = await import('@/lib/models')
    const org = await Organization.create({
      name: 'Worker Chunk Org',
      slug: `worker-chunk-${Date.now()}`,
      ownerId,
      timezone: 'UTC',
      monthlyStatementCalendar: 'gregorian',
    })
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    await Family.create(
      Array.from({ length: count }, (_, i) => ({
        organizationId: org._id,
        name: `Worker Family ${i}`,
        weddingDate: new Date('2010-01-01'),
        paymentPlanId: plan._id,
      })),
    )
    return org._id.toString()
  }

  it('worker resumes a family batch from familyCursor', async () => {
    const organizationId = await seedOrgWithFamilies(6)
    const { Family } = await import('@/lib/models')
    const families = await Family.find({ organizationId }).sort({ _id: 1 }).lean()

    const calculations = await import('@/lib/calculations')
    const period = await import('@/lib/statements/period')
    vi.spyOn(calculations, 'calculateFamilyBalance').mockResolvedValue({ openingBalance: 0, planCost: 0, totalPayments: 0, totalWithdrawals: 0, totalLifecyclePayments: 0, totalCycleCharges: 0, balance: 0 })
    vi.spyOn(period, 'loadStatementPeriod').mockResolvedValue({
      payments: [],
      priorPeriodRefunds: [],
      withdrawals: [],
      lifecycleEvents: [],
      cycleCharges: [],
      totalIncome: 0,
      totalWithdrawals: 0,
      totalExpenses: 0,
      totalCycleCharges: 0,
      closingBalance: 0,
    })

    const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements-worker')
    const first = await POST(
      cronJsonReq('/api/jobs/generate-monthly-statements/worker', 'POST', {
        query: `?organizationId=${organizationId}&year=2024&month=6`,
      }),
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.generated).toBe(5)
    expect(firstBody.hasMore).toBe(true)

    const second = await POST(
      cronJsonReq('/api/jobs/generate-monthly-statements/worker', 'POST', {
        query: `?organizationId=${organizationId}&year=2024&month=6&familyCursor=${String((families as import('@/lib/test/type-helpers').LeanDoc[])[4]._id)}`,
      }),
    )
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.generated).toBe(1)
    expect(secondBody.hasMore).toBe(false)

    const { Statement } = await import('@/lib/models')
    const rows = await Statement.find({ organizationId }).lean()
    expect(rows).toHaveLength(6)
  })

  it('worker returns 400 without organizationId', async () => {
    const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements-worker')
    const res = await POST(cronJsonReq('/api/jobs/generate-monthly-statements/worker', 'POST'))
    expect(res.status).toBe(400)
  })
})
