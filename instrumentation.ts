/**
 * Next.js server instrumentation hook — runs once when the Node runtime
 * boots (not during `next build`). Used for production env validation.
 */
export async function register() {
  const { validateProductionEnv } = await import('./lib/env-validation')
  validateProductionEnv()
}
