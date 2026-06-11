import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/** React components / views under app/ — smoke + interaction tests. */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app',
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./vitest.app.setup.ts'],
    testTimeout: 60_000,
    include: ['app/**/*.smoke.test.tsx', 'app/**/*.test.tsx'],
    exclude: ['app/api/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage-app',
      include: ['app/**/*.{tsx,ts}'],
      exclude: [
        'app/**/*.test.tsx',
        'app/**/*.smoke.test.tsx',
        'app/api/**',
        'app/**/loading.tsx',
        'app/**/error.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
