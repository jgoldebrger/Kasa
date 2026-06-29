/**
 * Platform-level OIDC SSO configuration (env-only for v1).
 *
 * Per-org IdP settings are planned for a later phase — see docs/sso-evaluation.md.
 */

export type OidcConfig = {
  issuer: string
  clientId: string
  clientSecret: string
  /** Shown on the login button, e.g. "Google Workspace". */
  providerName: string
  /** Email domain (lowercase) → organization slug for JIT provisioning. */
  domainOrgMap: Map<string, string>
}

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

/**
 * Parse `OIDC_DOMAIN_ORG_MAP` entries like `example.com:my-org,other.org:other-slug`.
 * Domains are normalized to lowercase; org slugs are trimmed but case-preserved
 * (Organization.slug is stored lowercase).
 */
export function parseOidcDomainOrgMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  const input = raw?.trim()
  if (!input) return map

  for (const entry of input.split(',')) {
    const piece = entry.trim()
    if (!piece) continue
    const colon = piece.indexOf(':')
    if (colon <= 0 || colon === piece.length - 1) continue
    const domain = piece.slice(0, colon).trim().toLowerCase()
    const slug = piece
      .slice(colon + 1)
      .trim()
      .toLowerCase()
    if (domain && slug) map.set(domain, slug)
  }

  return map
}

/** True when issuer, client id, and client secret are all configured. */
export function isOidcConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getOidcConfig(env) !== null
}

/**
 * Return OIDC settings when fully configured, otherwise null.
 * Partial configuration is ignored so credentials login keeps working
 * without accidental half-enabled SSO.
 */
export function getOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = trimEnv(env.OIDC_ISSUER)
  const clientId = trimEnv(env.OIDC_CLIENT_ID)
  const clientSecret = trimEnv(env.OIDC_CLIENT_SECRET)
  if (!issuer || !clientId || !clientSecret) return null

  return {
    issuer,
    clientId,
    clientSecret,
    providerName: trimEnv(env.OIDC_PROVIDER_NAME) || 'SSO',
    domainOrgMap: parseOidcDomainOrgMap(env.OIDC_DOMAIN_ORG_MAP),
  }
}

/** Public-safe subset for login UI and settings copy. */
export function getOidcPublicStatus(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean
  providerName: string
  hasDomainMapping: boolean
} {
  const config = getOidcConfig(env)
  if (!config) {
    return { enabled: false, providerName: 'SSO', hasDomainMapping: false }
  }
  return {
    enabled: true,
    providerName: config.providerName,
    hasDomainMapping: config.domainOrgMap.size > 0,
  }
}
