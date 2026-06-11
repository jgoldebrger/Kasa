import type { SecurityConfig, SecurityEnvironment } from './schema'

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name]
  return v !== undefined && v !== '' ? v : fallback
}

function envBool(name: string, fallback: boolean): boolean {
  const v = env(name)
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

function resolveEnvironment(): SecurityEnvironment {
  const raw = env('SECURITY_ENV', 'local') as SecurityEnvironment
  if (raw === 'local' || raw === 'staging' || raw === 'production-like') return raw
  return 'local'
}

function defaultBaseUrl(environment: SecurityEnvironment): string {
  if (environment === 'staging') {
    return env('SECURITY_STAGING_URL') || env('STAGING_URL') || 'https://staging.example.com'
  }
  if (environment === 'production-like') {
    return env('SECURITY_PROD_LIKE_URL') || env('PRODUCTION_URL') || 'https://app.example.com'
  }
  const port = env('E2E_PORT', '3000')
  return env('SECURITY_TARGET_URL') || env('NEXTAUTH_URL') || `http://127.0.0.1:${port}`
}

/**
 * Build typed security config from environment variables.
 * Local defaults align with e2e/seed.ts credentials.
 */
export function loadSecurityConfigFromEnv(): SecurityConfig {
  const environment = resolveEnvironment()
  const baseUrl = defaultBaseUrl(environment)

  const destructiveDefault = environment === 'local'

  const raw = {
    environment,
    baseUrl,
    allowDestructive: envBool('SECURITY_ALLOW_DESTRUCTIVE', destructiveDefault),
    owner: {
      email: env('SECURITY_OWNER_EMAIL', 'e2e@kasa.test')!,
      password: env('SECURITY_OWNER_PASSWORD', 'E2eTestPass123!')!,
      name: env('SECURITY_OWNER_NAME', 'E2E Test User'),
    },
    member: {
      email: env('SECURITY_MEMBER_EMAIL', 'e2e-member@kasa.test')!,
      password: env('SECURITY_MEMBER_PASSWORD', 'E2eMemberPass123!')!,
      name: env('SECURITY_MEMBER_NAME', 'E2E Member User'),
    },
    platformAdmin: env('SECURITY_PLATFORM_ADMIN_EMAIL')
      ? {
          email: env('SECURITY_PLATFORM_ADMIN_EMAIL')!,
          password: env('SECURITY_PLATFORM_ADMIN_PASSWORD', env('SECURITY_OWNER_PASSWORD', 'E2eTestPass123!')!)!,
        }
      : undefined,
    orgNames: {
      alpha: env('SECURITY_ORG_ALPHA', 'E2E Org Alpha')!,
      beta: env('SECURITY_ORG_BETA', 'E2E Org Beta')!,
    },
    proxy: {
      enabled: envBool('SECURITY_PROXY_ENABLED', !!env('SECURITY_PROXY_URL')),
      server: env('SECURITY_PROXY_URL') || env('HTTP_PROXY') || env('HTTPS_PROXY'),
      username: env('SECURITY_PROXY_USERNAME') || env('BURP_PROXY_USER'),
      password: env('SECURITY_PROXY_PASSWORD') || env('BURP_PROXY_PASS'),
      ignoreHttpsErrors: envBool('SECURITY_PROXY_IGNORE_TLS_ERRORS', true),
    },
    zap: {
      enabled: envBool('SECURITY_ZAP_ENABLED', false),
      apiUrl: env('SECURITY_ZAP_API_URL', 'http://127.0.0.1:8080')!,
      apiKey: env('SECURITY_ZAP_API_KEY') || env('ZAP_API_KEY'),
      dockerImage: env('SECURITY_ZAP_DOCKER_IMAGE', 'ghcr.io/zaproxy/zaproxy:stable')!,
      baselineTimeoutMs: Number(env('SECURITY_ZAP_TIMEOUT_MS', '600000')),
    },
    cronSecret: env('CRON_SECRET') || env('SECURITY_CRON_SECRET'),
    reportDir: env('SECURITY_REPORT_DIR', 'security/reports/output')!,
    captureHar: envBool('SECURITY_CAPTURE_HAR', true),
    captureTrafficLog: envBool('SECURITY_CAPTURE_TRAFFIC', true),
    concurrency: {
      rateLimitWorkers: Number(env('SECURITY_RATE_LIMIT_WORKERS', '10')),
      rateLimitBurst: Number(env('SECURITY_RATE_LIMIT_BURST', '30')),
    },
    headers: {
      orgIdHeader: env('SECURITY_ORG_HEADER', 'x-organization-id')!,
    },
  }

  return raw as SecurityConfig
}
