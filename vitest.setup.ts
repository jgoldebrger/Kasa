// Set required env vars BEFORE any module imports happen, so modules
// like lib/database.ts that throw at top-level if they're missing don't
// blow up during test collection.
const env = process.env as Record<string, string | undefined>
env.MONGODB_URI ||= 'mongodb://placeholder.invalid/test'
env.NEXTAUTH_SECRET ||= 'test-secret-do-not-use'
env.AUTH_SECRET ||= 'test-secret-do-not-use'
env.ENCRYPTION_KEY ||= 'test-encryption-key-do-not-use-1234'
env.NODE_ENV ||= 'test'

// Isolate Mongo data per Vitest worker so integration files can run in parallel.
const poolId = env.VITEST_POOL_ID ?? env.VITEST_WORKER_ID ?? '0'
env.KASA_TEST_DB_NAME = `kasa_vitest_${poolId}`

import { afterAll, vi } from 'vitest'

// Passthrough so lib/projections unstable_cache does not leak results across tests.
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

/** Disconnect mongoose after each worker finishes to avoid Vitest hang on exit. */
afterAll(async () => {
  try {
    const m = await import('mongoose')
    const mg = (m as { default?: typeof import('mongoose') }).default ?? m
    if (mg.connection?.readyState !== 0) {
      await mg.disconnect().catch(() => {})
    }
  } catch {
    // mongoose may not be loaded in every worker
  }
})
