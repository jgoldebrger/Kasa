import { describe, expect, it } from 'vitest'
import { DAILY_JOBS_BY_UTC_HOUR, EVERY_TICK_JOBS, jobsForTick } from './cron-schedule'

describe('jobsForTick', () => {
  it('always includes scheduled-email job', () => {
    expect(jobsForTick(12, 15)).toEqual([...EVERY_TICK_JOBS])
    expect(jobsForTick(2, 30)).toEqual([...EVERY_TICK_JOBS])
  })

  it('adds daily jobs at minute 0 for matching UTC hour', () => {
    expect(jobsForTick(2, 0)).toEqual([...EVERY_TICK_JOBS, ...DAILY_JOBS_BY_UTC_HOUR[2]!])
    expect(jobsForTick(8, 0)).toContain('/api/jobs/ops-digest')
  })

  it('does not add daily jobs at non-zero minutes', () => {
    expect(jobsForTick(2, 15)).not.toContain('/api/jobs/generate-monthly-statements')
  })
})
