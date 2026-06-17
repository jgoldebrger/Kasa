/**
 * Production boot-time environment validation.
 *
 * Called from `instrumentation.ts` (Next server start) and `connectDB()`
 * so misconfigured deploys fail fast with actionable errors. Skipped in
 * development/test/CI vitest runs — see `shouldValidateProductionEnv`.
 */

const MIN_CRON_SECRET_LEN = 32
const MIN_AUTH_SECRET_LEN = 16

let validated = false

/** @internal Reset idempotency guard between vitest cases. */
export function __resetEnvValidationForTests(): void {
  validated = false
}

/** True when we should enforce production env requirements. */
export function shouldValidateProductionEnv(): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  // Vitest workers set NODE_ENV=test in setup, but guard anyway.
  if (process.env.VITEST === 'true') return false
  return true
}

function requireNonEmpty(name: string, value: string | undefined, minLen?: number): string | null {
  if (!value || !value.trim()) {
    return `${name} must be set in production.`
  }
  if (minLen != null && value.length < minLen) {
    return `${name} must be at least ${minLen} characters in production.`
  }
  return null
}

/**
 * Validate required production secrets and connection strings.
 * No-op outside production; idempotent within a process.
 */
export function validateProductionEnv(): void {
  if (!shouldValidateProductionEnv() || validated) return

  const errors: string[] = []

  const cronErr = requireNonEmpty('CRON_SECRET', process.env.CRON_SECRET, MIN_CRON_SECRET_LEN)
  if (cronErr) errors.push(cronErr)

  const authSecret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  const authErr = requireNonEmpty('NEXTAUTH_SECRET or AUTH_SECRET', authSecret, MIN_AUTH_SECRET_LEN)
  if (authErr) errors.push(authErr)

  const mongoErr = requireNonEmpty('MONGODB_URI', process.env.MONGODB_URI)
  if (mongoErr) errors.push(mongoErr)

  // Email passwords + 2FA secrets are encrypted at rest; production must
  // use a dedicated key (see lib/encryption.ts).
  const encErr = requireNonEmpty('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY)
  if (encErr) errors.push(encErr)

  if (errors.length > 0) {
    throw new Error(
      `[env] Production environment validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    )
  }

  validated = true
}
