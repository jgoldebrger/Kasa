import { describe, expect, it } from 'vitest'
import {
  ALL_DAILY_TICK_JOBS,
  DAILY_JOBS_BY_UTC_HOUR,
  EVERY_TICK_JOBS,
  jobsForDailyTick,
  jobsForFrequentTick,
  jobsForTick,
} from './cron-schedule'

describe('jobsForFrequentTick', () => {
  it('always includes scheduled-email job', () => {
    expect(jobsForFrequentTick(12, 15)).toEqual([...EVERY_TICK_JOBS])
    expect(jobsForFrequentTick(2, 30)).toEqual([...EVERY_TICK_JOBS])
  })

  it('adds daily jobs at minute 0 for matching UTC hour', () => {
    expect(jobsForFrequentTick(2, 0)).toEqual([...EVERY_TICK_JOBS, ...DAILY_JOBS_BY_UTC_HOUR[2]!])
    expect(jobsForFrequentTick(8, 0)).toContain('/api/jobs/ops-digest')
  })

  it('does not add daily jobs at non-zero minutes', () => {
    expect(jobsForFrequentTick(2, 15)).not.toContain('/api/jobs/generate-monthly-statements')
  })
})

describe('jobsForDailyTick', () => {
  it('includes all jobs in order with ops-digest last', () => {
    const jobs = jobsForDailyTick()
    expect(jobs).toEqual([...ALL_DAILY_TICK_JOBS])
    expect(jobs.at(-1)).toBe('/api/jobs/ops-digest')
  })
})

describe('jobsForTick', () => {
  it('defaults to daily mode (all jobs)', () => {
    const prev = process.env.CRON_TICK_MODE
    delete process.env.CRON_TICK_MODE
    try {
      expect(jobsForTick(14, 37)).toEqual(jobsForDailyTick())
    } finally {
      if (prev === undefined) delete process.env.CRON_TICK_MODE
      else process.env.CRON_TICK_MODE = prev
    }
  })

  it('uses frequent mode when CRON_TICK_MODE=frequent', () => {
    const prev = process.env.CRON_TICK_MODE
    process.env.CRON_TICK_MODE = 'frequent'
    try {
      expect(jobsForTick(2, 0)).toEqual(jobsForFrequentTick(2, 0))
    } finally {
      if (prev === undefined) delete process.env.CRON_TICK_MODE
      else process.env.CRON_TICK_MODE = prev
    }
  })
})
