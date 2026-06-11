import { defineConfig } from 'vitest/config'

/** Root config: lib + api-routes Vitest projects run in parallel. */
export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
    projects: [
      './vitest.lib.config.ts',
      './vitest.api.config.ts',
      './vitest.app.config.ts',
      './vitest.route-logic.config.ts',
    ],
  },
})
