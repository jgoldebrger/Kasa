import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import { getSecurityConfig } from './config'
import { playwrightLaunchOptions } from './helpers/proxy'

const sec = getSecurityConfig()
const rootDir = path.join(__dirname)

export default defineConfig({
  testDir: path.join(rootDir, 'tests'),
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  globalSetup: path.join(rootDir, 'playwright', 'global-setup.ts'),
  globalTeardown: path.join(rootDir, 'playwright', 'global-teardown.ts'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(rootDir, 'reports', 'playwright-html'), open: 'never' }],
    ...(process.env.CI ? [['github'] as const] : []),
  ],
  use: {
    baseURL: sec.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...playwrightLaunchOptions(),
  },
  projects: [
    {
      name: 'sec-setup',
      testMatch: /auth\.setup\.ts/,
      testDir: path.join(rootDir, 'auth'),
    },
    {
      name: 'sec-guest',
      dependencies: ['sec-setup'],
      testMatch: /.*\.spec\.ts/,
      grep: /@guest-only/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'sec-authenticated',
      dependencies: ['sec-setup'],
      testMatch: /.*\.spec\.ts/,
      grepInvert: /@guest-only|@member-rbac/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(rootDir, 'playwright', '.auth', 'owner.json'),
      },
    },
    {
      name: 'sec-member-rbac',
      dependencies: ['sec-setup'],
      testMatch: /rbac-matrix\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(rootDir, 'playwright', '.auth', 'member.json'),
      },
    },
  ],
  webServer:
    sec.environment === 'local'
      ? {
          command: 'npx tsx e2e/start-dev.ts',
          cwd: path.join(__dirname, '..'),
          url: sec.baseUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 600_000,
          env: {
            ...process.env,
            E2E_BULK_FAMILIES: process.env.E2E_BULK_FAMILIES ?? '0',
            E2E_PORT: process.env.E2E_PORT ?? '3000',
            PLATFORM_ADMIN_EMAILS:
              process.env.PLATFORM_ADMIN_EMAILS ?? 'e2e@kasa.test',
            SECURITY_STRICT_RATE_LIMITS: '1',
          },
        }
      : undefined,
})
