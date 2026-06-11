/**
 * Route-logic project setup: mock NextAuth before handler/auth-helpers load.
 * Avoids next-auth -> next/server ESM resolution failures in Node test runs.
 */
import { vi } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => null),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/platform-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-admin')>()
  return {
    ...actual,
    assertPlatformAdminTwoFactor: vi.fn(async () => null),
  }
})

