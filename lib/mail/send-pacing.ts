const BULK_PACING_THRESHOLD = 10
const BULK_DELAY_MS = 200

/** Delay between bulk sends to avoid SMTP rate limits. */
export function delayBetweenSendsMs(count: number): number {
  return count > BULK_PACING_THRESHOLD ? BULK_DELAY_MS : 0
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
