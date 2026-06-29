import type { OidcConfig } from '@/lib/oidc-config'

/**
 * Generic OIDC provider for Auth.js v5 (no built-in `next-auth/providers/oidc` in beta.31).
 * Uses issuer discovery per the OpenID Connect spec.
 */
export function createOidcProvider(config: OidcConfig) {
  return {
    id: 'oidc',
    name: config.providerName,
    type: 'oidc' as const,
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { params: { scope: 'openid email profile' } },
  }
}
