import type { APIRequestContext } from '@playwright/test'
import { getSecurityConfig } from '../config'
import { mutateRequest } from './request-mutation'

export interface CsrfTestResult {
  endpoint: string
  method: string
  vector: string
  status: number
  passed: boolean
  detail: string
}

const CSRF_MUTATIONS: Array<{
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  data?: unknown
}> = [
  { method: 'PATCH', path: '/api/user', data: { name: 'csrf-probe' } },
  { method: 'POST', path: '/api/tasks', data: { title: 'csrf', email: 'a@b.c', priority: 'low' } },
  { method: 'PATCH', path: '/api/organizations', data: { activeOrgId: '000000000000000000000000' } },
]

/** POST/PATCH without Origin should be blocked by middleware CSRF check. */
export async function testMissingOriginBlocked(
  request: APIRequestContext,
  mutations = CSRF_MUTATIONS,
): Promise<CsrfTestResult[]> {
  const results: CsrfTestResult[] = []
  for (const m of mutations) {
    const res = await mutateRequest(request, {
      method: m.method,
      path: m.path,
      data: m.data,
      stripOrigin: true,
    })
    const status = res.status()
    const passed = status === 403 || status === 401
    results.push({
      endpoint: m.path,
      method: m.method,
      vector: 'missing-origin',
      status,
      passed,
      detail: passed ? 'CSRF blocked (no Origin)' : `Accepted without Origin (${status})`,
    })
  }
  return results
}

/** Cross-site Origin should be rejected. */
export async function testEvilOriginBlocked(
  request: APIRequestContext,
  mutations = CSRF_MUTATIONS,
): Promise<CsrfTestResult[]> {
  const config = getSecurityConfig()
  const evil = 'https://evil-attacker.example'
  const results: CsrfTestResult[] = []
  for (const m of mutations) {
    const res = await mutateRequest(request, {
      method: m.method,
      path: m.path,
      data: m.data,
      evilOrigin: evil,
    })
    const status = res.status()
    const passed = status === 403
    results.push({
      endpoint: m.path,
      method: m.method,
      vector: 'evil-origin',
      status,
      passed,
      detail: passed
        ? 'Cross-site Origin blocked'
        : `Cross-site Origin accepted (${status}) from ${evil} vs ${config.baseUrl}`,
    })
  }
  return results
}

/** Valid Origin should succeed (sanity check — session required). */
export async function testSameOriginAllowed(
  request: APIRequestContext,
  path: string,
): Promise<CsrfTestResult> {
  const res = await mutateRequest(request, { method: 'GET', path })
  const status = res.status()
  return {
    endpoint: path,
    method: 'GET',
    vector: 'same-origin-get',
    status,
    passed: status < 500,
    detail: `GET with same-origin: ${status}`,
  }
}
