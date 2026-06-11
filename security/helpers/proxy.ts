import type { BrowserContextOptions } from '@playwright/test'
import { getSecurityConfig } from '../config'

type PlaywrightProxy = NonNullable<BrowserContextOptions['proxy']>

/** Playwright proxy settings for Burp Suite / OWASP ZAP / mitmproxy. */
export function buildPlaywrightProxy(): PlaywrightProxy | undefined {
  const { proxy } = getSecurityConfig()
  if (!proxy.enabled || !proxy.server) return undefined

  return {
    server: proxy.server,
    username: proxy.username,
    password: proxy.password,
  }
}

export function playwrightLaunchOptions(): Pick<
  BrowserContextOptions,
  'proxy' | 'ignoreHTTPSErrors'
> {
  const config = getSecurityConfig()
  const proxy = buildPlaywrightProxy()
  return {
    ...(proxy ? { proxy } : {}),
    ignoreHTTPSErrors: config.proxy.ignoreHttpsErrors,
  }
}

export function burpProxyHint(): string {
  return [
    'Burp: set SECURITY_PROXY_URL=http://127.0.0.1:8080',
    'Export Burp CA to security/certs/burp-ca.pem and set NODE_EXTRA_CA_CERTS if needed.',
    'ZAP: SECURITY_PROXY_URL=http://127.0.0.1:8081 (typical) or run npm run security:zap:up',
  ].join('\n')
}
