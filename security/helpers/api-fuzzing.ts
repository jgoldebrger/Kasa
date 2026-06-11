import type { APIRequestContext } from '@playwright/test'
import { INJECTION_PAYLOADS } from '../payloads/injection'
import { mutateRequest } from './request-mutation'

export interface FuzzResult {
  endpoint: string
  payload: string
  status: number
  passed: boolean
  detail: string
}

export interface FuzzTarget {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  /** Field to inject into for POST/PUT/PATCH */
  field?: string
  baseBody?: Record<string, unknown>
}

export async function fuzzJsonField(
  request: APIRequestContext,
  target: FuzzTarget,
  payloads: unknown[],
): Promise<FuzzResult[]> {
  const results: FuzzResult[] = []
  for (const payload of payloads) {
    const body = { ...(target.baseBody ?? {}) }
    if (target.field) body[target.field] = payload
    const res = await mutateRequest(request, {
      method: target.method,
      path: target.path,
      data: body,
    })
    const status = res.status()
    results.push({
      endpoint: target.path,
      payload: JSON.stringify(payload).slice(0, 120),
      status,
      passed: status !== 500,
      detail: status === 500 ? 'Server error on fuzz input' : `Status ${status}`,
    })
  }
  return results
}

export async function fuzzQueryParams(
  request: APIRequestContext,
  path: string,
  param: string,
  values: string[],
): Promise<FuzzResult[]> {
  const results: FuzzResult[] = []
  for (const v of values) {
    const res = await mutateRequest(request, {
      method: 'GET',
      path: `${path}?${param}=${encodeURIComponent(v)}`,
    })
    const status = res.status()
    results.push({
      endpoint: path,
      payload: v,
      status,
      passed: status !== 500,
      detail: `Query fuzz → ${status}`,
    })
  }
  return results
}

export const DEFAULT_FUZZ_TARGETS: FuzzTarget[] = [
  {
    method: 'GET',
    path: '/api/search',
    field: 'q',
  },
  {
    method: 'POST',
    path: '/api/tasks',
    field: 'title',
    baseBody: { email: 'fuzz@test.invalid', priority: 'low', status: 'pending' },
  },
]

export async function runDefaultFuzzSuite(
  request: APIRequestContext,
): Promise<FuzzResult[]> {
  const results: FuzzResult[] = []
  results.push(
    ...(await fuzzQueryParams(request, '/api/search', 'q', [
      ...INJECTION_PAYLOADS.sql.slice(0, 2),
      "';--",
      '<script>',
    ])),
  )
  results.push(
    ...(await fuzzJsonField(request, DEFAULT_FUZZ_TARGETS[1], INJECTION_PAYLOADS.nosql.slice(0, 3))),
  )
  return results
}
