import type { APIRequestContext } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'

/** CSRF-safe headers for Playwright APIRequestContext (mirrors browser Origin). */
export function apiMutationHeaders(path = '/settings'): Record<string, string> {
  return {
    origin: BASE,
    referer: `${BASE}${path}`,
  }
}

export async function apiPut(
  request: APIRequestContext,
  path: string,
  data: unknown,
  refererPath?: string,
) {
  return request.put(path, {
    data,
    headers: apiMutationHeaders(refererPath),
  })
}

export async function apiPost(
  request: APIRequestContext,
  path: string,
  data: unknown,
  refererPath?: string,
) {
  return request.post(path, {
    data,
    headers: apiMutationHeaders(refererPath),
  })
}
