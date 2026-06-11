import { setNodeEnv } from '@/lib/test/type-helpers'
/**
 * Branch/function coverage for lib/route-logic/jobs/* cron handlers.
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

function cronJsonReq(
  path: string,
  method: string,
  opts?: { query?: string },
): NextRequest {
  const secret = process.env.CRON_SECRET || 'test-cron-secret'
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': ctx.orgId,
    'x-cron-secret': secret,
    authorization: `Bearer ${secret}`,
  }
  const q = opts?.query ?? ''
  return new NextRequest(`${API_ORIGIN}${path}${q}`, { method, headers })
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

async function seedJobLock(jobName: string) {
  const { JobLock } = await import('@/lib/models')
  const lockKey = new Date().toISOString().slice(0, 10)
  await JobLock.deleteMany({ jobName, lockKey })
  await JobLock.create({
    jobName,
    lockKey,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return lockKey
}

async function clearJobLock(jobName: string, lockKey: string) {
  const { JobLock } = await import('@/lib/models')
  await JobLock.deleteMany({ jobName, lockKey })
}

describe.sequential('jobs route-logic branch coverage', () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  describe('cycle-rollover', () => {
    it('returns 429 when rate limited and GET aliases POST', async () => {
      const { POST, GET } = await import('@/lib/route-logic/jobs/cycle-rollover')
      await withRateLimitBlocked(async () => {
        expect((await POST(cronJsonReq('/api/jobs/cycle-rollover', 'POST'))).status).toBe(429)
      })
      const lockKey = await seedJobLock('cycle-rollover')
      try {
        expect((await GET(cronJsonReq('/api/jobs/cycle-rollover', 'GET'))).status).toBe(200)
      } finally {
        await clearJobLock('cycle-rollover', lockKey)
      }
    })

    it('skips when lock held and sanitizes production errors', async () => {
      const lockKey = await seedJobLock('cycle-rollover')
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const skipped = await POST(cronJsonReq('/api/jobs/cycle-rollover', 'POST'))
        expect(skipped.status).toBe(200)
        expect((await skipped.json()).skipped).toBe(true)
      } finally {
        await clearJobLock('cycle-rollover', lockKey)
      }

      vi.stubEnv('NODE_ENV', 'production')
      const sanitize = await import('@/lib/payments/sanitize')
      const sanitizeSpy = vi.spyOn(sanitize, 'sanitizeStripeErrorMessage').mockReturnValue('')
      const jobs = await import('@/lib/jobs')
      const scheduleSpy = vi.spyOn(jobs, 'cycleConfigMatchesSchedule').mockReturnValue(true)
      const rollover = await import('@/lib/cycle-rollover')
      const rolloverSpy = vi
        .spyOn(rollover, 'runCycleRolloverForOrg')
        .mockRejectedValueOnce(new Error('pi_secret123'))
      const { CycleConfig, JobLock } = await import('@/lib/models')
      const todayKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'cycle-rollover', lockKey: todayKey })
      await CycleConfig.updateOne(
        { organizationId: ctx.orgId, isActive: true },
        { $set: { cycleAutoRollover: true, cycleCalendar: 'gregorian' } },
        { upsert: true },
      )
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const res = await POST(cronJsonReq('/api/jobs/cycle-rollover', 'POST'))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
        expect(body.errors[0].error).toBe('Processing failed')
      } finally {
        rolloverSpy.mockRestore()
        scheduleSpy.mockRestore()
        sanitizeSpy.mockRestore()
        vi.unstubAllEnvs()
      }
    })

    it('records stringified non-Error throws and rethrows outer failures', async () => {
      const jobs = await import('@/lib/jobs')
      const scheduleSpy = vi.spyOn(jobs, 'cycleConfigMatchesSchedule').mockReturnValue(true)
      const rollover = await import('@/lib/cycle-rollover')
      const rolloverSpy = vi
        .spyOn(rollover, 'runCycleRolloverForOrg')
        .mockRejectedValueOnce('plain string failure')
      const { CycleConfig, JobLock } = await import('@/lib/models')
      const todayKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'cycle-rollover', lockKey: todayKey })
      await CycleConfig.updateOne(
        { organizationId: ctx.orgId, isActive: true },
        { $set: { cycleAutoRollover: true, cycleCalendar: 'gregorian' } },
        { upsert: true },
      )
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const res = await POST(cronJsonReq('/api/jobs/cycle-rollover', 'POST'))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.errors.some((e: { error: string }) => e.error === 'plain string failure')).toBe(
          true,
        )
      } finally {
        rolloverSpy.mockRestore()
        scheduleSpy.mockRestore()
      }

      const pag = await import('@/lib/org-pagination')
      const loadSpy = vi.spyOn(pag, 'loadAllByIdCursor').mockRejectedValueOnce(new Error('db down'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const fail = await POST(cronJsonReq('/api/jobs/cycle-rollover', 'POST'))
        expect(fail.status).toBe(500)
      } finally {
        loadSpy.mockRestore()
      }

      const loadStringSpy = vi
        .spyOn(pag, 'loadAllByIdCursor')
        .mockRejectedValueOnce('outer string failure')
      try {
        const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
        const fail = await POST(cronJsonReq('/api/jobs/cycle-rollover', 'POST'))
        expect(fail.status).toBe(500)
      } finally {
        loadStringSpy.mockRestore()
      }
    })
  })

  describe('wedding-converter', () => {
    it('returns 429, lock skip, GET alias, and non-prod 500 details', async () => {
      const { POST, GET } = await import('@/lib/route-logic/jobs/wedding-converter')
      await withRateLimitBlocked(async () => {
        expect((await POST(cronJsonReq('/api/jobs/wedding-converter', 'POST'))).status).toBe(429)
      })

      const lockKey = await seedJobLock('wedding-converter')
      try {
        const skipped = await POST(cronJsonReq('/api/jobs/wedding-converter', 'POST'))
        expect((await skipped.json()).skipped).toBe(true)
        expect((await GET(cronJsonReq('/api/jobs/wedding-converter', 'GET'))).status).toBe(200)
      } finally {
        await clearJobLock('wedding-converter', lockKey)
      }

      const prev = process.env.NODE_ENV
      setNodeEnv('development'
)
      const { FamilyMember } = await import('@/lib/models')
      const distinctSpy = vi
        .spyOn(FamilyMember, 'distinct')
        .mockRejectedValueOnce(new Error('distinct boom'))
      try {
        const failed = await POST(cronJsonReq('/api/jobs/wedding-converter', 'POST'))
        expect(failed.status).toBe(500)
        const body = await failed.json()
        expect(body.details).toBe('distinct boom')
      } finally {
        distinctSpy.mockRestore()
        setNodeEnv(prev
)
      }

      vi.stubEnv('NODE_ENV', 'production')
      const prodDistinctSpy = vi
        .spyOn(FamilyMember, 'distinct')
        .mockRejectedValueOnce(new Error('prod distinct fail'))
      try {
        const failed = await POST(cronJsonReq('/api/jobs/wedding-converter', 'POST'))
        expect(failed.status).toBe(500)
        const body = await failed.json()
        expect(body.details).toBeUndefined()
      } finally {
        prodDistinctSpy.mockRestore()
        vi.unstubAllEnvs()
      }

      const plainDistinctSpy = vi
        .spyOn(FamilyMember, 'distinct')
        .mockRejectedValueOnce('plain outer fail')
      try {
        const failed = await POST(cronJsonReq('/api/jobs/wedding-converter', 'POST'))
        expect(failed.status).toBe(500)
      } finally {
        plainDistinctSpy.mockRestore()
      }
    })

    it('sanitizes production errors and stringifies non-Error per-org failures', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const sanitize = await import('@/lib/payments/sanitize')
      const sanitizeSpy = vi.spyOn(sanitize, 'sanitizeStripeErrorMessage').mockReturnValue('')
      const { FamilyMember } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Branch',
        lastName: 'Cover',
        weddingDate: new Date('2018-06-01'),
        gender: 'male',
      })
      const wc = await import('@/lib/wedding-converter')
      const convertSpy = vi
        .spyOn(wc, 'convertMembersOnWeddingDate')
        .mockRejectedValueOnce('wedding plain fail')
      try {
        const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
        const res = await POST(cronJsonReq('/api/jobs/wedding-converter', 'POST'))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
        expect(body.errors[0].error).toBe('Processing failed')
      } finally {
        convertSpy.mockRestore()
        sanitizeSpy.mockRestore()
        vi.unstubAllEnvs()
        await FamilyMember.deleteOne({ _id: member._id })
      }
    })
  })

  describe('generate-monthly-statements', () => {
    it('returns 429, lock skip, and GET alias', async () => {
      const { POST, GET } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
      await withRateLimitBlocked(async () => {
        expect((await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))).status).toBe(
          429,
        )
      })

      const lockKey = await seedJobLock('generate-monthly-statements')
      try {
        const skipped = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect((await skipped.json()).skipped).toBe(true)
        expect((await GET(cronJsonReq('/api/jobs/generate-monthly-statements', 'GET'))).status).toBe(
          200,
        )
      } finally {
        await clearJobLock('generate-monthly-statements', lockKey)
      }
    })

    it('skips schedule-mismatched orgs, processes matching orgs, and accepts cursor batches', async () => {
      const { Organization, JobLock } = await import('@/lib/models')
      const wrongDay = ((new Date().getUTCDate() % 28) + 1) || 1
      const matchDay = new Date().getUTCDate()
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            monthlyStatementAutoGenerate: true,
            monthlyStatementCalendar: 'gregorian',
            monthlyStatementDay: wrongDay === matchDay ? wrongDay + 1 : wrongDay,
            timezone: 'UTC',
          },
        },
      )
      await JobLock.deleteMany({ jobName: 'generate-monthly-statements' })
      const scheduler = await import('@/lib/scheduler')
      const genSpy = vi.spyOn(scheduler, 'generateMonthlyStatements').mockResolvedValue({ success: true, month: 1, year: 2024, generated: 0, failed: 0, statements: [], errors: [], hasMore: false, familyCursorOut: null })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const mismatch = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect(mismatch.status).toBe(200)
        expect(genSpy).not.toHaveBeenCalled()

        await Organization.updateOne(
          { _id: ctx.orgId },
          { $set: { monthlyStatementDay: matchDay } },
        )
        genSpy.mockClear()
        const matched = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect(matched.status).toBe(200)
        expect(genSpy).toHaveBeenCalledWith(
          ctx.orgId,
          undefined,
          undefined,
          expect.objectContaining({
            selfUrl: expect.stringContaining('/api/jobs/generate-monthly-statements/worker'),
          }),
        )

        const cursor = new Types.ObjectId('000000000000000000000001').toString()
        const cont = await POST(
          cronJsonReq('/api/jobs/generate-monthly-statements', 'POST', {
            query: `?cursor=${encodeURIComponent(cursor)}`,
          }),
        )
        expect(cont.status).toBe(200)
      } finally {
        genSpy.mockRestore()
        await Organization.updateOne(
          { _id: ctx.orgId },
          { $unset: { monthlyStatementAutoGenerate: 1, monthlyStatementDay: 1 } },
        )
        await JobLock.deleteMany({ jobName: 'generate-monthly-statements' })
      }
    })

    it('releases lock when runChunked throws', async () => {
      const { JobLock } = await import('@/lib/models')
      await JobLock.deleteMany({ jobName: 'generate-monthly-statements' })
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockRejectedValueOnce(new Error('chunk fail'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const fail = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect(fail.status).toBe(500)
        const lock = await JobLock.findOne({ jobName: 'generate-monthly-statements' })
        expect(lock).toBeNull()
      } finally {
        spy.mockRestore()
      }
    })

    it('keeps lock when more batches remain and skips missing org rows', async () => {
      const { JobLock, Organization } = await import('@/lib/models')
      await JobLock.deleteMany({ jobName: 'generate-monthly-statements' })
      const jobs = await import('@/lib/jobs')
      const hasMoreSpy = vi.spyOn(jobs, 'runChunked').mockResolvedValueOnce({
        hasMore: true,
        cursorOut: ctx.orgId,
        jobRunId: 'jr',
        processed: 1,
        failed: 0,
        errors: [],
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
        const lock = await JobLock.findOne({ jobName: 'generate-monthly-statements' })
        expect(lock).not.toBeNull()
      } finally {
        hasMoreSpy.mockRestore()
        await JobLock.deleteMany({ jobName: 'generate-monthly-statements' })
      }

      const findSpy = vi.spyOn(Organization, 'findById').mockReturnValue({
        select: () => ({
          lean: async () => null,
        }),
      } as never)
      const runSpy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 1,
          failed: 0,
          errors: [],
        }
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
      } finally {
        findSpy.mockRestore()
        runSpy.mockRestore()
      }

      const deleteSpy = vi
        .spyOn(JobLock, 'deleteOne')
        .mockRejectedValueOnce(new Error('delete fail'))
      const doneSpy = vi.spyOn(jobs, 'runChunked').mockResolvedValueOnce({
        hasMore: false,
        cursorOut: null,
        jobRunId: 'jr',
        processed: 0,
        failed: 0,
        errors: [],
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/generate-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/generate-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
        expect(deleteSpy).toHaveBeenCalled()
      } finally {
        deleteSpy.mockRestore()
        doneSpy.mockRestore()
      }
    })
  })

  describe('process-recurring-payments', () => {
    it('returns 429, lock skip, GET alias, and successful per-org fetch', async () => {
      const { POST, GET } = await import('@/lib/route-logic/jobs/process-recurring-payments')
      await withRateLimitBlocked(async () => {
        expect(
          (await POST(cronJsonReq('/api/jobs/process-recurring-payments', 'POST'))).status,
        ).toBe(429)
      })

      const lockKey = await seedJobLock('process-recurring-payments')
      try {
        const skipped = await POST(cronJsonReq('/api/jobs/process-recurring-payments', 'POST'))
        expect((await skipped.json()).skipped).toBe(true)
        expect((await GET(cronJsonReq('/api/jobs/process-recurring-payments', 'GET'))).status).toBe(
          200,
        )
      } finally {
        await clearJobLock('process-recurring-payments', lockKey)
      }

      const { JobLock } = await import('@/lib/models')
      await JobLock.deleteMany({ jobName: 'process-recurring-payments' })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }))
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 1,
          failed: 0,
          errors: [],
        }
      })
      try {
        const res = await POST(cronJsonReq('/api/jobs/process-recurring-payments', 'POST'))
        expect(res.status).toBe(200)
        expect((await res.json()).processed).toBe(1)
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    it('accepts cursor continuation and throws when fetch response text fails', async () => {
      const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
      const cursor = new Types.ObjectId('000000000000000000000001').toString()
      const cont = await POST(
        cronJsonReq('/api/jobs/process-recurring-payments', 'POST', {
          query: `?cursor=${encodeURIComponent(cursor)}`,
        }),
      )
      expect(cont.status).toBe(200)

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          text: async () => {
            throw new Error('text read fail')
          },
        }),
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
      try {
        const fail = await POST(cronJsonReq('/api/jobs/process-recurring-payments', 'POST'))
        expect(fail.status).toBe(500)
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    it('retains lock for mid-chain batches and tolerates lock cleanup failures', async () => {
      const { JobLock } = await import('@/lib/models')
      await JobLock.deleteMany({ jobName: 'process-recurring-payments' })
      const jobs = await import('@/lib/jobs')
      const hasMoreSpy = vi.spyOn(jobs, 'runChunked').mockResolvedValueOnce({
        hasMore: true,
        cursorOut: ctx.orgId,
        jobRunId: 'jr',
        processed: 1,
        failed: 0,
        errors: [],
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
        const res = await POST(cronJsonReq('/api/jobs/process-recurring-payments', 'POST'))
        expect(res.status).toBe(200)
        expect(await JobLock.findOne({ jobName: 'process-recurring-payments' })).not.toBeNull()
      } finally {
        hasMoreSpy.mockRestore()
        await JobLock.deleteMany({ jobName: 'process-recurring-payments' })
      }

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }))
      const doneSpy = vi.spyOn(jobs, 'runChunked').mockResolvedValueOnce({
        hasMore: false,
        cursorOut: null,
        jobRunId: 'jr',
        processed: 1,
        failed: 0,
        errors: [],
      })
      const deleteSpy = vi
        .spyOn(JobLock, 'deleteOne')
        .mockRejectedValueOnce(new Error('delete fail'))
      try {
        const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
        const res = await POST(cronJsonReq('/api/jobs/process-recurring-payments', 'POST'))
        expect(res.status).toBe(200)
        expect(deleteSpy).toHaveBeenCalled()
      } finally {
        doneSpy.mockRestore()
        deleteSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })
  })

  describe('send-monthly-statements', () => {
    it('returns 429, lock skip, GET alias, and schedule-mismatch skip', async () => {
      const { POST, GET } = await import('@/lib/route-logic/jobs/send-monthly-statements')
      await withRateLimitBlocked(async () => {
        expect((await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))).status).toBe(
          429,
        )
      })

      const lockKey = await seedJobLock('send-monthly-statements')
      try {
        const skipped = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect((await skipped.json()).skipped).toBe(true)
        expect((await GET(cronJsonReq('/api/jobs/send-monthly-statements', 'GET'))).status).toBe(200)
      } finally {
        await clearJobLock('send-monthly-statements', lockKey)
      }

      const { Organization } = await import('@/lib/models')
      const wrongDay = ((new Date().getUTCDate() % 28) + 1) || 1
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            monthlyStatementAutoEmail: true,
            monthlyStatementCalendar: 'gregorian',
            monthlyStatementDay: wrongDay,
            timezone: 'UTC',
          },
        },
      )
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
      vi.stubGlobal('fetch', fetchSpy)
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 1,
          failed: 0,
          errors: [],
        }
      })
      try {
        const res = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
        await Organization.updateOne({ _id: ctx.orgId }, { $unset: { monthlyStatementAutoEmail: 1 } })
      }
    })

    it('emails on schedule match, accepts cursor batches, and handles fetch failures', async () => {
      const { Organization } = await import('@/lib/models')
      const matchDay = new Date().getUTCDate()
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            monthlyStatementAutoEmail: true,
            monthlyStatementCalendar: 'gregorian',
            monthlyStatementDay: matchDay,
            timezone: 'UTC',
          },
        },
      )
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' })
      vi.stubGlobal('fetch', fetchSpy)
      const jobs = await import('@/lib/jobs')
      const spy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 1,
          failed: 0,
          errors: [],
        }
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
        expect(fetchSpy).toHaveBeenCalled()

        const cursor = new Types.ObjectId('000000000000000000000001').toString()
        const cont = await POST(
          cronJsonReq('/api/jobs/send-monthly-statements', 'POST', {
            query: `?cursor=${encodeURIComponent(cursor)}`,
          }),
        )
        expect(cont.status).toBe(200)
      } finally {
        spy.mockRestore()
        vi.unstubAllGlobals()
        await Organization.updateOne({ _id: ctx.orgId }, { $unset: { monthlyStatementAutoEmail: 1 } })
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => {
            throw new Error('body unreadable')
          },
        }),
      )
      const failSpy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
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
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const fail = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect(fail.status).toBe(500)
      } finally {
        failSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    it('keeps lock for mid-chain batches and skips missing org rows', async () => {
      const { JobLock, Organization } = await import('@/lib/models')
      await JobLock.deleteMany({ jobName: 'send-monthly-statements' })
      const jobs = await import('@/lib/jobs')
      const hasMoreSpy = vi.spyOn(jobs, 'runChunked').mockResolvedValueOnce({
        hasMore: true,
        cursorOut: ctx.orgId,
        jobRunId: 'jr',
        processed: 1,
        failed: 0,
        errors: [],
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
        expect(await JobLock.findOne({ jobName: 'send-monthly-statements' })).not.toBeNull()
      } finally {
        hasMoreSpy.mockRestore()
        await JobLock.deleteMany({ jobName: 'send-monthly-statements' })
      }

      const findSpy = vi.spyOn(Organization, 'findById').mockReturnValue({
        select: () => ({
          lean: async () => null,
        }),
      } as never)
      vi.stubGlobal('fetch', vi.fn())
      const runSpy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 1,
          failed: 0,
          errors: [],
        }
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
      } finally {
        findSpy.mockRestore()
        runSpy.mockRestore()
        vi.unstubAllGlobals()
      }

      const deleteSpy = vi
        .spyOn(JobLock, 'deleteOne')
        .mockRejectedValueOnce(new Error('delete fail'))
      const doneSpy = vi.spyOn(jobs, 'runChunked').mockResolvedValueOnce({
        hasMore: false,
        cursorOut: null,
        jobRunId: 'jr',
        processed: 0,
        failed: 0,
        errors: [],
      })
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(cronJsonReq('/api/jobs/send-monthly-statements', 'POST'))
        expect(res.status).toBe(200)
        expect(deleteSpy).toHaveBeenCalled()
      } finally {
        deleteSpy.mockRestore()
        doneSpy.mockRestore()
      }
    })
  })
})
