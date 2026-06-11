import type { APIRequestContext } from '@playwright/test'
import { IDOR_LEAK_STATUSES, IDOR_SAFE_STATUSES } from '../payloads/idor-vectors'
import { mutateRequest, withOrgHeader } from './request-mutation'

export interface IdorTestResult {
  resource: string
  vector: string
  status: number
  passed: boolean
  detail: string
}

export interface CrossTenantFixture {
  homeOrgId: string
  foreignOrgId: string
  homeResourceId: string
  foreignResourceId: string
}

/**
 * Attempt to access a foreign resource while scoped to home org via header.
 * Pass = 403/404/401 (denied). Fail = 200 with foreign data.
 */
export async function testCrossTenantResourceAccess(
  request: APIRequestContext,
  fixture: CrossTenantFixture,
  pathTemplate: string,
): Promise<IdorTestResult> {
  const foreignPath = pathTemplate.replace('{id}', fixture.foreignResourceId)
  const res = await mutateRequest(request, {
    method: 'GET',
    path: foreignPath,
    headers: withOrgHeader(fixture.homeOrgId),
  })
  const status = res.status()
  const passed = IDOR_SAFE_STATUSES.has(status) || !IDOR_LEAK_STATUSES.has(status)
  let detail = `Status ${status}`
  if (IDOR_LEAK_STATUSES.has(status)) {
    const body = await res.text()
    if (body.includes(fixture.foreignResourceId)) {
      detail = `Cross-tenant leak: foreign resource returned ${status}`
      return { resource: foreignPath, vector: 'header-org-id', status, passed: false, detail }
    }
  }
  return {
    resource: foreignPath,
    vector: 'header-org-id',
    status,
    passed: IDOR_SAFE_STATUSES.has(status),
    detail: passed ? 'Access correctly denied' : detail,
  }
}

/** Valid ObjectId the caller is not a member of (for header-spoof probes). */
export const NON_MEMBER_ORG_ID = '507f1f77bcf86cd799439011'

export async function testOrgHeaderSpoofing(
  request: APIRequestContext,
  foreignOrgId: string,
  probePath: string,
): Promise<IdorTestResult> {
  const res = await mutateRequest(request, {
    method: 'GET',
    path: probePath,
    headers: withOrgHeader(foreignOrgId),
  })
  const status = res.status()
  const passed = status === 403 || status === 401
  return {
    resource: probePath,
    vector: 'spoofed-x-organization-id',
    status,
    passed,
    detail: passed
      ? 'Foreign org header rejected'
      : `Unexpected ${status} with spoofed org header`,
  }
}

export async function testInsecureDirectObjectReference(
  request: APIRequestContext,
  paths: string[],
): Promise<IdorTestResult[]> {
  const results: IdorTestResult[] = []
  for (const path of paths) {
    const res = await mutateRequest(request, { method: 'GET', path })
    const status = res.status()
    results.push({
      resource: path,
      vector: 'direct-id-guess',
      status,
      passed: status !== 500,
      detail: status === 500 ? 'Server error on IDOR probe' : `Responded ${status}`,
    })
  }
  return results
}
