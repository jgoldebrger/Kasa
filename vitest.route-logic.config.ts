import path from 'path'
import { defineConfig } from 'vitest/config'

/** API implementation coverage — enable in vitest.config.ts workspace when at 100%. */
export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
    name: 'route-logic',
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts', './vitest.route-logic.setup.ts', './vitest.api.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      'app/api/api-routes.integration.test.ts',
      'app/api/route-logic-finish.integration.test.ts',
      'lib/import-csv.integration.test.ts',
      'lib/import-csv.unit.test.ts',
      'lib/stripe-webhook.integration.test.ts',
      'lib/import-route-logic.integration.test.ts',
      'lib/route-logic/**/*.test.ts',
    ],
    exclude: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage-route-logic',
      include: ['lib/route-logic/**/*.ts'],
      exclude: ['lib/route-logic/auth/\\[...nextauth\\].ts'],
      thresholds: { lines: 100, perFile: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // next-auth imports `next/server` without extension; Node ESM needs the .js path.
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
})
