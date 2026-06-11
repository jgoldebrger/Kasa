import type { APIRequestContext } from '@playwright/test'
import { getSecurityConfig } from '../config'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface MutatedRequestOptions {
  method?: HttpMethod
  path: string
  headers?: Record<string, string>
  data?: unknown
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>
  params?: Record<string, string>
  /** Strip Origin/Referer to test CSRF middleware. */
  stripOrigin?: boolean
  /** Use cross-site Origin to simulate attacker. */
  evilOrigin?: string
}

function mergeHeaders(
  base: Record<string, string> | undefined,
  opts: MutatedRequestOptions,
  baseUrl: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...(base ?? {}) }
  if (opts.stripOrigin) {
    headers['origin'] = ''
    headers['referer'] = ''
  }
  if (opts.evilOrigin) {
    headers['origin'] = opts.evilOrigin
    headers['referer'] = opts.evilOrigin + '/'
  }
  if (!opts.stripOrigin && !opts.evilOrigin && !headers['origin']) {
    const host = new URL(baseUrl).origin
    headers['origin'] = host
  }
  return headers
}

export async function mutateRequest(
  request: APIRequestContext,
  opts: MutatedRequestOptions,
): Promise<ReturnType<APIRequestContext['fetch']>> {
  const config = getSecurityConfig()
  const url = opts.path.startsWith('http') ? opts.path : `${config.baseUrl}${opts.path}`
  const headers = mergeHeaders(opts.headers, opts, config.baseUrl)
  const method = opts.method ?? 'GET'

  const init = {
    method,
    headers,
    data: opts.data,
    multipart: opts.multipart,
    params: opts.params,
  }

  return request.fetch(url, init)
}

export function withOrgHeader(orgId: string): Record<string, string> {
  const config = getSecurityConfig()
  return { [config.headers.orgIdHeader]: orgId }
}

export function withoutAuthCookies(): { storageState: { cookies: []; origins: [] } } {
  return { storageState: { cookies: [], origins: [] } }
}

export function tamperCookieValue(value: string): string {
  if (value.length < 8) return value + 'TAMPERED'
  const mid = Math.floor(value.length / 2)
  return value.slice(0, mid) + 'XX' + value.slice(mid + 2)
}

export function stripBearerPrefix(token: string): string {
  return token.startsWith('Bearer ') ? token.slice(7) : token
}
