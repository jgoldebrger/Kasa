import path from 'path'
import { defineConfig } from 'vitest/config'

/** API route catalog — runs in parallel with lib project; coverage report only. */
export default defineConfig({
  test: {
    name: 'api-routes',
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts', './vitest.api.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: true,
    include: ['app/api/api-routes.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage-api',
      include: ['app/api/**/route.ts', 'lib/api-handlers/**/handler.ts'],
      thresholds: {
        lines: 100,
        statements: 88,
        branches: 75,
        functions: 90,
        perFile: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
