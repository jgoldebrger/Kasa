import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findLean: vi.fn(async () => [] as { _id: string }[]),
  findOneLean: vi.fn(async () => null as { _id: string; status: string } | null),
  updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  findByIdAndUpdate: vi.fn(async () => ({})),
  selfUrl: vi.fn(() => 'https://app.test/api/worker'),
  fetch: vi.fn(),
}))

vi.mock('./models', () => ({
  EmailJob: {
    find: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(() => ({
          lean: mocks.findLean,
        })),
      })),
    })),
    findOne: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: mocks.findOneLean,
      })),
    })),
    updateMany: mocks.updateMany,
    findByIdAndUpdate: mocks.findByIdAndUpdate,
  },
}))

vi.mock('./jobs', () => ({
  selfUrl: mocks.selfUrl,
}))

import {
  EMAIL_JOB_STALE_AFTER_MS,
  findActiveEmailJob,
  kickoffEmailWorker,
  sweepStaleEmailJobs,
} from './email-jobs'

describe('EMAIL_JOB_STALE_AFTER_MS', () => {
  it('is 30 minutes', () => {
    expect(EMAIL_JOB_STALE_AFTER_MS).toBe(30 * 60 * 1000)
  })
})

describe('findActiveEmailJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findOneLean.mockResolvedValue(null)
  })

  it('returns queued or running job for org and kind', async () => {
    mocks.findOneLean.mockResolvedValue({ _id: 'job-1', status: 'running' })

    const job = await findActiveEmailJob({
      organizationId: '507f1f77bcf86cd799439011',
      kind: 'statements',
    })

    expect(job).toEqual({ _id: 'job-1', status: 'running' })
  })
})

describe('sweepStaleEmailJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findLean.mockResolvedValue([])
    mocks.updateMany.mockResolvedValue({ modifiedCount: 0 })
  })

  it('returns empty result when no stale jobs exist', async () => {
    const result = await sweepStaleEmailJobs()

    expect(result).toEqual({ swept: 0, jobIds: [] })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it('marks stale running jobs as failed', async () => {
    mocks.findLean.mockResolvedValueOnce([{ _id: 'job-a' }, { _id: 'job-b' }])
    mocks.findLean.mockResolvedValueOnce([])

    const result = await sweepStaleEmailJobs({
      organizationId: 'org-1',
      kind: 'tax-receipts',
      staleAfterMs: 60_000,
    })

    expect(result.swept).toBe(2)
    expect(result.jobIds).toEqual(['job-a', 'job-b'])
    expect(mocks.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['job-a', 'job-b'] } },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          lastError: expect.stringContaining('1 minutes'),
        }),
      }),
    )
  })
})

describe('kickoffEmailWorker', () => {
  const request = {
    url: 'https://app.test/api/kickoff',
    headers: new Headers({ cookie: 'session=abc' }),
  } as import('next/server').NextRequest

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    process.env.CRON_SECRET = 'cron-test-secret'
  })

  it('returns ok when worker responds successfully', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => '',
    })

    const result = await kickoffEmailWorker({
      request,
      workerPath: '/api/statements/send-emails/worker',
      jobId: 'job-1',
      organizationId: 'org-1',
      body: { jobId: 'job-1' },
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.selfUrl).toHaveBeenCalledWith(
      request,
      '/api/statements/send-emails/worker',
    )
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://app.test/api/worker',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-cron-secret': 'cron-test-secret',
        }),
      }),
    )
  })

  it('marks job failed when worker fetch throws a non-Error value', async () => {
    mocks.fetch.mockRejectedValueOnce('network down')

    const result = await kickoffEmailWorker({
      request,
      workerPath: '/worker',
      jobId: 'job-non-error',
      organizationId: 'org-1',
      body: {},
    })

    expect(result).toEqual({ ok: false, error: 'Worker kickoff failed' })
    expect(mocks.findByIdAndUpdate).toHaveBeenCalledWith(
      'job-non-error',
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          lastError: 'Worker kickoff failed',
        }),
      }),
    )
  })

  it('marks job failed when worker fetch throws', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('connection reset'))

    const result = await kickoffEmailWorker({
      request,
      workerPath: '/worker',
      jobId: 'job-err',
      organizationId: 'org-1',
      body: {},
    })

    expect(result).toEqual({ ok: false, error: 'connection reset' })
    expect(mocks.findByIdAndUpdate).toHaveBeenCalledWith(
      'job-err',
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          lastError: 'connection reset',
        }),
      }),
    )
  })

  it('marks job failed when worker HTTP status is not ok', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    })

    const result = await kickoffEmailWorker({
      request,
      workerPath: '/worker',
      jobId: 'job-1',
      organizationId: 'org-1',
      body: {},
    })

    expect(result.ok).toBe(false)
    expect(mocks.findByIdAndUpdate).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          lastError: expect.stringContaining('HTTP 500'),
        }),
      }),
    )
  })
})
