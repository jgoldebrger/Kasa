import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOrg: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireOrg: mocks.requireOrg,
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    NextResponse: {
      json: vi.fn((body: unknown, init?: { status?: number }) => ({
        body,
        status: init?.status ?? 200,
      })),
    },
  }
})

import { NextResponse } from 'next/server'
import { isCronRequest, requireOrgOrCron } from './auth-cron'
import { signCronJob, verifyCronJob } from './auth-cron-job'

function cronRequest(init: { secret?: string; bearer?: string; url?: string } = {}): Request {
  const headers = new Headers()
  if (init.secret) headers.set('x-cron-secret', init.secret)
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`)
  return new Request(
    init.url ?? 'https://app.test/api/jobs/run?organizationId=507f1f77bcf86cd799439011',
    { headers },
  )
}

describe('isCronRequest', () => {
  const prevSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevSecret
  })

  it('returns false when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET
    expect(isCronRequest(cronRequest({ secret: 'anything' }))).toBe(false)
  })

  it('accepts x-cron-secret header', () => {
    expect(isCronRequest(cronRequest({ secret: 'test-cron-secret' }))).toBe(true)
    expect(isCronRequest(cronRequest({ secret: 'wrong' }))).toBe(false)
  })

  it('accepts Authorization Bearer token', () => {
    expect(isCronRequest(cronRequest({ bearer: 'test-cron-secret' }))).toBe(true)
    expect(isCronRequest(cronRequest({ bearer: 'wrong' }))).toBe(false)
  })

  it('rejects empty x-cron-secret and bare Bearer', () => {
    expect(isCronRequest(cronRequest({ secret: '' }))).toBe(false)
    expect(isCronRequest(cronRequest({ bearer: '' }))).toBe(false)
    const headers = new Headers({ authorization: 'Bearer ' })
    expect(isCronRequest(new Request('https://app.test/api/jobs/run', { headers }))).toBe(false)
  })

  it('prefers valid header when both signals are present but one is wrong', () => {
    const headers = new Headers({
      'x-cron-secret': 'test-cron-secret',
      authorization: 'Bearer wrong',
    })
    expect(isCronRequest(new Request('https://app.test/api/jobs/run', { headers }))).toBe(true)

    headers.set('x-cron-secret', 'wrong')
    headers.set('authorization', 'Bearer test-cron-secret')
    expect(isCronRequest(new Request('https://app.test/api/jobs/run', { headers }))).toBe(true)
  })

  it('rejects when both cron signals are present but invalid', () => {
    const headers = new Headers({
      'x-cron-secret': 'wrong',
      authorization: 'Bearer also-wrong',
    })
    expect(isCronRequest(new Request('https://app.test/api/jobs/run', { headers }))).toBe(false)
  })
})

describe('requireOrgOrCron', () => {
  const prevSecret = process.env.CRON_SECRET
  const validOrgId = '507f1f77bcf86cd799439011'

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    vi.clearAllMocks()
    vi.mocked(NextResponse.json).mockImplementation(
      (body, init) =>
        ({
          body,
          status: init?.status ?? 200,
        }) as unknown as NextResponse,
    )
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevSecret
  })

  it('returns synthetic cron context for valid cron + organizationId', async () => {
    const req = cronRequest({ secret: 'test-cron-secret' }) as import('next/server').NextRequest

    const ctx = await requireOrgOrCron(req)

    expect(ctx).toEqual({
      session: {
        user: {
          id: 'cron',
          email: 'cron@system',
          name: 'cron',
          memberships: [],
        },
      },
      userId: 'cron',
      organizationId: validOrgId,
      role: 'member',
      isCron: true,
    })
    expect(mocks.requireOrg).not.toHaveBeenCalled()
  })

  it('returns 400 when cron is valid but organizationId is missing or invalid', async () => {
    const req = new Request('https://app.test/api/jobs/run?organizationId=not-an-id', {
      headers: { 'x-cron-secret': 'test-cron-secret' },
    }) as import('next/server').NextRequest

    const ctx = await requireOrgOrCron(req)

    expect(NextResponse.json).toHaveBeenCalledWith(
      { error: 'Cron call requires ?organizationId=<id>' },
      { status: 400 },
    )
    expect(ctx).toMatchObject({ status: 400 })
    expect(mocks.requireOrg).not.toHaveBeenCalled()
  })

  it('delegates to requireOrg when request is not a cron call', async () => {
    const sessionCtx = {
      session: {
        user: { id: 'u1', email: 'a@b.com', name: 'A', memberships: [] },
      },
      userId: 'u1',
      organizationId: validOrgId,
      role: 'admin' as const,
    }
    mocks.requireOrg.mockResolvedValue(sessionCtx)

    const req = new Request('https://app.test/api/jobs/run') as import('next/server').NextRequest
    const ctx = await requireOrgOrCron(req, { minRole: 'admin' })

    expect(mocks.requireOrg).toHaveBeenCalledWith(req, { minRole: 'admin' })
    expect(ctx).toBe(sessionCtx)
  })
})

describe('signCronJob / verifyCronJob', () => {
  const prevSecret = process.env.CRON_SECRET
  const validOrgId = '507f1f77bcf86cd799439011'
  const jobName = 'process-recurring-payments'

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevSecret
  })

  function jobRequest(
    init: {
      jobToken?: string
      jobTokenQuery?: string
      organizationId?: string
      secret?: string
    } = {},
  ): Request {
    const headers = new Headers()
    if (init.jobToken) headers.set('x-cron-job-token', init.jobToken)
    if (init.secret) headers.set('x-cron-secret', init.secret)
    const qs = new URLSearchParams()
    if (init.organizationId) qs.set('organizationId', init.organizationId)
    if (init.jobTokenQuery) qs.set('jobToken', init.jobTokenQuery)
    const query = qs.toString()
    return new Request(`https://app.test/api/jobs/${jobName}${query ? `?${query}` : ''}`, {
      headers,
    })
  }

  it('signs and verifies a job token via header', () => {
    const token = signCronJob({
      jobName,
      expiresAt: Date.now() + 60_000,
    })
    expect(verifyCronJob(jobRequest({ jobToken: token }), jobName)).toBe(true)
  })

  it('accepts job token via jobToken query param', () => {
    const token = signCronJob({
      jobName,
      expiresAt: Date.now() + 60_000,
    })
    expect(verifyCronJob(jobRequest({ jobTokenQuery: token }), jobName)).toBe(true)
  })

  it('requires organizationId in token when URL has organizationId', () => {
    const tokenWithoutOrg = signCronJob({
      jobName,
      expiresAt: Date.now() + 60_000,
    })
    expect(
      verifyCronJob(jobRequest({ jobToken: tokenWithoutOrg, organizationId: validOrgId }), jobName),
    ).toBe(false)

    const tokenWithOrg = signCronJob({
      jobName,
      organizationId: validOrgId,
      expiresAt: Date.now() + 60_000,
    })
    expect(
      verifyCronJob(jobRequest({ jobToken: tokenWithOrg, organizationId: validOrgId }), jobName),
    ).toBe(true)
  })

  it('rejects expired, wrong job name, and tampered tokens', () => {
    const expired = signCronJob({
      jobName,
      expiresAt: Date.now() - 1000,
    })
    expect(verifyCronJob(jobRequest({ jobToken: expired }), jobName)).toBe(false)

    const otherJob = signCronJob({
      jobName: 'cycle-rollover',
      expiresAt: Date.now() + 60_000,
    })
    expect(verifyCronJob(jobRequest({ jobToken: otherJob }), jobName)).toBe(false)

    const valid = signCronJob({ jobName, expiresAt: Date.now() + 60_000 })
    const tampered = `${valid}x`
    expect(verifyCronJob(jobRequest({ jobToken: tampered }), jobName)).toBe(false)
  })

  it('still accepts global cron secret for backward compatibility', () => {
    expect(verifyCronJob(jobRequest({ secret: 'test-cron-secret' }), jobName)).toBe(true)
  })

  it('returns false when neither global secret nor job token is valid', () => {
    const token = signCronJob({ jobName, expiresAt: Date.now() + 60_000 })
    expect(verifyCronJob(jobRequest({ jobToken: token, secret: 'wrong' }), 'other-job')).toBe(false)
    expect(verifyCronJob(jobRequest(), jobName)).toBe(false)
  })
})
