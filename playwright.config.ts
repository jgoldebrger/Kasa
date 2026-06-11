import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const PORT = process.env.E2E_PORT || '3000'
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'guest',
      testMatch: /guest\.spec\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'e2e', '.auth', 'user.json'),
      },
      testIgnore: [/auth\.setup\.ts/, /guest\.spec\.ts/],
    },
  ],
  webServer: {
    command: 'npx tsx e2e/start-dev.ts',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: {
      E2E_BULK_FAMILIES: process.env.E2E_BULK_FAMILIES ?? '0',
      E2E_BASE_URL: BASE_URL,
    },
  },
})
