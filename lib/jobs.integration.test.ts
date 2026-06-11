import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

const logErrorMock = vi.hoisted(() => vi.fn())
vi.mock('./log', () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}))

describe('jobs runChunked (integration)', () => {
  const ownerId = new Types.ObjectId()

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, JobRun } = await import('./models')
    await Organization.deleteMany({})
    await JobRun.deleteMany({})
    vi.unstubAllGlobals()
    delete process.env.CRON_SECRET
    logErrorMock.mockClear()
  })

  it('processes one batch and records a JobRun', async () => {
    const { Organization } = await import('./models')
    const { runChunked } = await import('./jobs')

    await Organization.create([
      { name: 'Org A', slug: 'org-a-chunk', ownerId },
      { name: 'Org B', slug: 'org-b-chunk', ownerId },
    ])

    const perOrg = vi.fn(async () => undefined)
    const result = await runChunked({
      name: 'test-chunk',
      batchSize: 10,
      selfUrl: 'https://example.com/api/jobs/test-chunk',
      perOrg,
    })

    expect(result.processed).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.hasMore).toBe(false)
    expect(result.cursorOut).toBeNull()
    expect(perOrg).toHaveBeenCalledTimes(2)
  })

  it('continues with cursor and triggers the next batch when more orgs remain', async () => {
    const { Organization } = await import('./models')
    const { runChunked } = await import('./jobs')

    const orgs = await Organization.create(
      Array.from({ length: 3 }, (_, i) => ({
        name: `Org ${i}`,
        slug: `org-chunk-${i}`,
        ownerId,
      })),
    )

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.CRON_SECRET = 'test-secret'

    const perOrg = vi.fn(async () => undefined)
    const result = await runChunked({
      name: 'test-chunk-paginated',
      batchSize: 2,
      selfUrl: 'https://example.com/api/jobs/test-chunk-paginated',
      perOrg,
    })

    expect(result.processed).toBe(2)
    expect(result.hasMore).toBe(true)
    expect(result.cursorOut).toBe(orgs[1]._id.toString())

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('cursor=')
    expect(url).toContain(orgs[1]._id.toString())
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-cron-secret']).toBe('test-secret')
  })

  it('records per-org failures without aborting the batch', async () => {
    const { Organization } = await import('./models')
    const { runChunked } = await import('./jobs')

    await Organization.create({ name: 'Fail Org', slug: 'org-fail-chunk', ownerId })

    const result = await runChunked({
      name: 'test-chunk-failures',
      batchSize: 5,
      selfUrl: 'https://example.com/api/jobs/test-chunk-failures',
      perOrg: async () => {
        throw new Error('boom')
      },
    })

    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('boom')
  })

  it('resumes after cursor skipping already-processed orgs', async () => {
    const { Organization } = await import('./models')
    const { runChunked } = await import('./jobs')

    const orgs = await Organization.create(
      Array.from({ length: 3 }, (_, i) => ({
        name: `Paged Org ${i}`,
        slug: `org-paged-${i}`,
        ownerId,
      })),
    )

    const result = await runChunked({
      name: 'test-chunk-resume',
      batchSize: 10,
      cursor: orgs[0]._id.toString(),
      selfUrl: 'https://example.com/api/jobs/test-chunk-resume',
      perOrg: async () => undefined,
    })

    expect(result.processed).toBe(2)
    expect(result.hasMore).toBe(false)
  })

  it('logs when the next batch cannot be triggered without CRON_SECRET', async () => {
    const { Organization } = await import('./models')
    const { runChunked } = await import('./jobs')

    await Organization.create(
      Array.from({ length: 3 }, (_, i) => ({
        name: `No Secret Org ${i}`,
        slug: `org-nosecret-${i}`,
        ownerId,
      })),
    )

    const result = await runChunked({
      name: 'test-chunk-no-secret',
      batchSize: 2,
      selfUrl: 'https://example.com/api/jobs/test-chunk-no-secret',
      perOrg: async () => undefined,
    })

    expect(result.hasMore).toBe(true)
    await vi.waitFor(() => expect(logErrorMock).toHaveBeenCalled())
  })

  it('logs when the next batch trigger receives a non-OK response', async () => {
    const { Organization } = await import('./models')
    const { runChunked } = await import('./jobs')

    await Organization.create(
      Array.from({ length: 3 }, (_, i) => ({
        name: `Fail Fetch Org ${i}`,
        slug: `org-failfetch-${i}`,
        ownerId,
      })),
    )

    process.env.CRON_SECRET = 'test-secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const result = await runChunked({
      name: 'test-chunk-bad-fetch',
      batchSize: 2,
      selfUrl: 'https://example.com/api/jobs/test-chunk-bad-fetch',
      perOrg: async () => undefined,
    })

    expect(result.hasMore).toBe(true)
    await vi.waitFor(() => expect(logErrorMock).toHaveBeenCalled())
  })
})

describe('jobs runChunkedFamilies (integration)', () => {
  const ownerId = new Types.ObjectId()
  let organizationId: string

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Family, JobRun } = await import('./models')
    await Family.deleteMany({})
    await JobRun.deleteMany({})
    vi.unstubAllGlobals()
    delete process.env.CRON_SECRET
    logErrorMock.mockClear()
  })

  async function seedFamilies(count: number) {
    const { Organization, PaymentPlan, Family } = await import('./models')
    const org = await Organization.create({
      name: 'Family Chunk Org',
      slug: `fam-chunk-${Date.now()}`,
      ownerId,
    })
    organizationId = org._id.toString()
    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    await Family.create(
      Array.from({ length: count }, (_, i) => ({
        organizationId: org._id,
        name: `Family ${i}`,
        weddingDate: new Date('2010-01-01'),
        paymentPlanId: plan._id,
      })),
    )
  }

  it('processes one family batch and records a JobRun', async () => {
    await seedFamilies(3)
    const { runChunkedFamilies } = await import('./jobs')

    const perFamily = vi.fn(async () => undefined)
    const result = await runChunkedFamilies({
      name: 'test-family-chunk',
      organizationId,
      batchSize: 10,
      selfUrl: 'https://example.com/api/jobs/generate-monthly-statements/worker',
      triggerContinuation: false,
      perFamily,
    })

    expect(result.processed).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.hasMore).toBe(false)
    expect(result.familyCursorOut).toBeNull()
    expect(perFamily).toHaveBeenCalledTimes(3)
  })

  it('continues with familyCursor and triggers the next batch when more families remain', async () => {
    await seedFamilies(7)
    const { Family } = await import('./models')
    const { runChunkedFamilies } = await import('./jobs')

    const families = await Family.find({ organizationId }).sort({ _id: 1 }).lean() as import('@/lib/test/type-helpers').LeanDoc[]
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.CRON_SECRET = 'test-secret'

    const perFamily = vi.fn(async () => undefined)
    const result = await runChunkedFamilies({
      name: 'test-family-chunk-paginated',
      organizationId,
      batchSize: 5,
      selfUrl: 'https://example.com/api/jobs/generate-monthly-statements/worker',
      perFamily,
    })

    expect(result.processed).toBe(5)
    expect(result.hasMore).toBe(true)
    expect(result.familyCursorOut).toBe(String(families[4]._id))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('familyCursor=')
    expect(url).toContain('organizationId=')
    expect(url).toContain(organizationId)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-cron-secret']).toBe('test-secret')
  })

  it('resumes after familyCursor skipping already-processed families', async () => {
    await seedFamilies(4)
    const { Family } = await import('./models')
    const { runChunkedFamilies } = await import('./jobs')

    const families = await Family.find({ organizationId }).sort({ _id: 1 }).lean() as import('@/lib/test/type-helpers').LeanDoc[]
    const perFamily = vi.fn(async () => undefined)
    const result = await runChunkedFamilies({
      name: 'test-family-chunk-resume',
      organizationId,
      batchSize: 10,
      familyCursor: String(families[1]._id),
      selfUrl: 'https://example.com/api/jobs/generate-monthly-statements/worker',
      triggerContinuation: false,
      perFamily,
    })

    expect(result.processed).toBe(2)
    expect(result.hasMore).toBe(false)
  })
})
