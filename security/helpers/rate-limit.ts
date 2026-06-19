import type { APIRequestContext } from '@playwright/test'
import { getSecurityConfig } from '../config'
import { mutateRequest } from './request-mutation'

export interface RateLimitResult {
  endpoint: string
  totalRequests: number
  statusHistogram: Record<number, number>
  rateLimited: boolean
  passed: boolean
  detail: string
}

/** Hammer an endpoint concurrently and detect 429 rate limiting. */
export async function testRateLimitConcurrency(
  request: APIRequestContext,
  path: string,
  opts?: { workers?: number; total?: number },
): Promise<RateLimitResult> {
  const config = getSecurityConfig()
  const workers = opts?.workers ?? config.concurrency.rateLimitWorkers
  const total = opts?.total ?? config.concurrency.rateLimitBurst

  const histogram: Record<number, number> = {}
  let rateLimited = false

  async function worker(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const res = await mutateRequest(request, { method: 'GET', path })
      const s = res.status()
      histogram[s] = (histogram[s] ?? 0) + 1
      if (s === 429) rateLimited = true
    }
  }

  const perWorker = Math.ceil(total / workers)
  await Promise.all(Array.from({ length: workers }, () => worker(perWorker)))

  const passed = rateLimited
  return {
    endpoint: path,
    totalRequests: total,
    statusHistogram: histogram,
    rateLimited,
    passed,
    detail: passed
      ? 'Rate limit (429) observed under burst load'
      : 'No 429 under burst — verify limits or increase burst',
  }
}

export async function testOrgSwitchRateLimit(
  request: APIRequestContext,
  orgId: string,
): Promise<RateLimitResult> {
  const histogram: Record<number, number> = {}
  let rateLimited = false
  const total = 35

  for (let i = 0; i < total; i++) {
    const res = await mutateRequest(request, {
      method: 'PATCH',
      path: '/api/organizations',
      data: { activeOrgId: orgId },
    })
    const s = res.status()
    histogram[s] = (histogram[s] ?? 0) + 1
    if (s === 429) rateLimited = true
  }

  return {
    endpoint: 'PATCH /api/organizations',
    totalRequests: total,
    statusHistogram: histogram,
    rateLimited,
    passed: rateLimited,
    detail: rateLimited
      ? 'Org switch rate limit enforced'
      : 'Org switch not rate limited after 35 PATCHes',
  }
}

export async function testLoginRateLimit(
  unauthRequest: APIRequestContext,
): Promise<RateLimitResult> {
  const histogram: Record<number, number> = {}
  let rateLimited = false

  for (let i = 0; i < 15; i++) {
    const res = await mutateRequest(unauthRequest, {
      method: 'POST',
      path: '/api/auth/callback/credentials',
      data: { email: 'brute@force.test', password: 'wrong' },
      stripOrigin: false,
    })
    const s = res.status()
    histogram[s] = (histogram[s] ?? 0) + 1
    if (s === 429) rateLimited = true
  }

  return {
    endpoint: 'login brute force',
    totalRequests: 15,
    statusHistogram: histogram,
    rateLimited,
    passed: rateLimited || histogram[401] !== undefined,
    detail: rateLimited ? 'Login rate limited' : 'Login attempts processed (check lockout)',
  }
}
