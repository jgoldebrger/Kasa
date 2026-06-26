/**
 * UTC cron schedule for the unified `/api/jobs/tick` dispatcher.
 *
 * Vercel Hobby allows only one `crons[]` entry in vercel.json. This map
 * preserves the previous per-route schedules: the tick runs every 15
 * minutes (scheduled emails) and fans out daily jobs at minute :00.
 */

/** Paths invoked on every tick (every 15 minutes). */
export const EVERY_TICK_JOBS = ['/api/jobs/send-scheduled-emails'] as const

/**
 * Daily jobs keyed by UTC hour, run only when `minute === 0`.
 * Mirrors the former vercel.json `crons` entries.
 */
export const DAILY_JOBS_BY_UTC_HOUR: Readonly<Record<number, readonly string[]>> = {
  1: ['/api/jobs/cycle-rollover'],
  2: ['/api/jobs/generate-monthly-statements', '/api/jobs/process-recurring-payments'],
  3: ['/api/jobs/send-monthly-statements'],
  4: ['/api/jobs/wedding-converter'],
  5: ['/api/jobs/run-email-drips'],
  8: ['/api/jobs/ops-digest'],
}

export function jobsForTick(utcHour: number, utcMinute: number): string[] {
  const jobs: string[] = [...EVERY_TICK_JOBS]
  if (utcMinute === 0) {
    const daily = DAILY_JOBS_BY_UTC_HOUR[utcHour]
    if (daily) jobs.push(...daily)
  }
  return jobs
}
