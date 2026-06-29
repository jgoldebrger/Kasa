/**
 * UTC cron schedule for the unified `/api/jobs/tick` dispatcher.
 *
 * Vercel Hobby: one cron entry, once per day only (`0 H * * *`).
 * Set CRON_TICK_MODE=frequent and a 15-minute vercel.json schedule on Pro.
 */

/** Paths invoked on every tick when `CRON_TICK_MODE=frequent` (Pro). */
export const EVERY_TICK_JOBS = [
  '/api/jobs/send-scheduled-emails',
  '/api/jobs/send-scheduled-reports',
] as const

/**
 * Daily jobs keyed by UTC hour — used only in `frequent` mode at minute :00.
 * Mirrors the former per-route vercel.json schedules.
 */
export const DAILY_JOBS_BY_UTC_HOUR: Readonly<Record<number, readonly string[]>> = {
  1: ['/api/jobs/cycle-rollover'],
  2: ['/api/jobs/generate-monthly-statements', '/api/jobs/process-recurring-payments'],
  3: ['/api/jobs/send-monthly-statements'],
  4: ['/api/jobs/wedding-converter'],
  5: ['/api/jobs/run-email-drips'],
  8: ['/api/jobs/ops-digest'],
}

/**
 * All jobs in dependency-safe order for once-daily Hobby ticks.
 * `ops-digest` runs last so it can report failures from earlier jobs.
 */
export const ALL_DAILY_TICK_JOBS: readonly string[] = [
  '/api/jobs/cycle-rollover',
  '/api/jobs/generate-monthly-statements',
  '/api/jobs/process-recurring-payments',
  '/api/jobs/send-monthly-statements',
  '/api/jobs/wedding-converter',
  '/api/jobs/run-email-drips',
  '/api/jobs/send-scheduled-emails',
  '/api/jobs/send-scheduled-reports',
  '/api/jobs/ops-digest',
]

export function isFrequentCronMode(): boolean {
  return process.env.CRON_TICK_MODE === 'frequent'
}

/** Pro: every-15-min tick with hourly fan-out. */
export function jobsForFrequentTick(utcHour: number, utcMinute: number): string[] {
  const jobs: string[] = [...EVERY_TICK_JOBS]
  if (utcMinute === 0) {
    const daily = DAILY_JOBS_BY_UTC_HOUR[utcHour]
    if (daily) jobs.push(...daily)
  }
  return jobs
}

/** Hobby: single daily invocation — run every job. */
export function jobsForDailyTick(): string[] {
  return [...ALL_DAILY_TICK_JOBS]
}

export function jobsForTick(utcHour: number, utcMinute: number): string[] {
  return isFrequentCronMode() ? jobsForFrequentTick(utcHour, utcMinute) : jobsForDailyTick()
}
