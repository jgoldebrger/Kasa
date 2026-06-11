import { SecurityConfigSchema, type SecurityConfig } from './schema'
import { loadSecurityConfigFromEnv } from './environments'

let cached: SecurityConfig | null = null

/** Validated, singleton security configuration for the current process. */
export function getSecurityConfig(): SecurityConfig {
  if (!cached) {
    const raw = loadSecurityConfigFromEnv()
    cached = SecurityConfigSchema.parse(raw)
  }
  return cached
}

export function resetSecurityConfigForTests(): void {
  cached = null
}

export * from './schema'
export * from './environments'
