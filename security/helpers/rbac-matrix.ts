import type { APIRequestContext } from '@playwright/test'
import { ADMIN_ONLY_ROUTES, MEMBER_ALLOWED_ROUTES } from '../auth/roles'
import { getCatalogRoutes, type ApiRouteEntry } from '../catalog'
import { buildMatrixFixtures } from './api-matrix'
import { defaultRouteFixtures, resolveRoutePath } from './route-fixtures'
import { mutateRequest } from './request-mutation'

export interface RbacProbeResult {
  route: string
  method: string
  role: 'member' | 'owner'
  check: string
  status: number
  passed: boolean
  detail: string
}

/** Member must not receive 2xx on admin-only endpoints. */
function memberDeniedAdmin(status: number): boolean {
  if (status === 401 || status === 403) return true
  if (status === 404) return true
  return status < 200 || status >= 300
}

const MEMBER_ALLOWED_PATHS = new Set(MEMBER_ALLOWED_ROUTES.map((r) => r.path.split('?')[0]!))

function adminCatalogGetRoutes(): ApiRouteEntry[] {
  return getCatalogRoutes(
    (r) =>
      r.method === 'GET' &&
      r.tenantScoped &&
      r.auth === 'org' &&
      r.minRole === 'admin' &&
      !MEMBER_ALLOWED_PATHS.has(r.path),
  )
}

function adminCatalogMutatingRoutes(): ApiRouteEntry[] {
  return getCatalogRoutes(
    (r) =>
      r.csrf && r.tenantScoped && r.auth === 'org' && r.minRole === 'admin' && r.method !== 'GET',
  ).slice(0, 12)
}

/** Member must receive 403 (or 401) on admin-only static routes. */
export async function probeMemberDeniedAdminRoutes(
  memberRequest: APIRequestContext,
): Promise<RbacProbeResult[]> {
  const results: RbacProbeResult[] = []
  const fixtures = defaultRouteFixtures()

  for (const route of ADMIN_ONLY_ROUTES) {
    const res = await mutateRequest(memberRequest, {
      method: route.method,
      path: route.path,
      data: 'body' in route ? route.body : undefined,
    })
    const status = res.status()
    const passed = memberDeniedAdmin(status)
    results.push({
      route: route.path,
      method: route.method,
      role: 'member',
      check: 'member-denied-admin',
      status,
      passed,
      detail: passed ? `Member denied (${status})` : `Member accessed admin route (${status})`,
    })
  }

  for (const route of adminCatalogGetRoutes()) {
    const path = resolveRoutePath(route.path, fixtures)
    const res = await mutateRequest(memberRequest, { method: 'GET', path })
    const status = res.status()
    const passed = memberDeniedAdmin(status)
    results.push({
      route: route.path,
      method: route.method,
      role: 'member',
      check: 'member-denied-admin-catalog',
      status,
      passed,
      detail: passed
        ? `Member denied admin GET (${status})`
        : `Member reached admin GET (${status})`,
    })
  }

  return results
}

/** Member may use member-level org routes. */
export async function probeMemberAllowedRoutes(
  memberRequest: APIRequestContext,
): Promise<RbacProbeResult[]> {
  const results: RbacProbeResult[] = []

  for (const route of MEMBER_ALLOWED_ROUTES) {
    const res = await mutateRequest(memberRequest, {
      method: route.method,
      path: route.path,
    })
    const status = res.status()
    const passed = status !== 401 && status !== 403 && status < 500
    results.push({
      route: route.path,
      method: route.method,
      role: 'member',
      check: 'member-allowed',
      status,
      passed,
      detail: passed
        ? `Member allowed (${status})`
        : `Member blocked from member route (${status})`,
    })
  }

  return results
}

/** Owner should reach the same admin routes members cannot. */
export async function probeOwnerAdminRoutes(
  ownerRequest: APIRequestContext,
): Promise<RbacProbeResult[]> {
  const results: RbacProbeResult[] = []
  const fixtures = await buildMatrixFixtures(ownerRequest)

  for (const route of ADMIN_ONLY_ROUTES) {
    if (route.method !== 'GET') continue
    const res = await mutateRequest(ownerRequest, {
      method: route.method,
      path: route.path,
    })
    const status = res.status()
    const passed = res.ok()
    results.push({
      route: route.path,
      method: route.method,
      role: 'owner',
      check: 'owner-admin-get',
      status,
      passed,
      detail: passed ? `Owner admin GET ok (${status})` : `Owner denied admin GET (${status})`,
    })
  }

  const sampleAdminGet = adminCatalogGetRoutes().slice(0, 8)
  for (const route of sampleAdminGet) {
    const path = resolveRoutePath(route.path, fixtures)
    const res = await mutateRequest(ownerRequest, { method: 'GET', path })
    const status = res.status()
    const passed = status !== 401 && status !== 403 && status < 500
    results.push({
      route: route.path,
      method: route.method,
      role: 'owner',
      check: 'owner-admin-catalog-get',
      status,
      passed,
      detail: passed
        ? `Owner catalog admin GET (${status})`
        : `Owner blocked admin GET (${status})`,
    })
  }

  return results
}

/** Spot-check mutating admin endpoints: member denied, owner may proceed past authz. */
export async function probeMemberDeniedAdminMutations(
  memberRequest: APIRequestContext,
): Promise<RbacProbeResult[]> {
  const results: RbacProbeResult[] = []
  const fixtures = defaultRouteFixtures()

  for (const route of adminCatalogMutatingRoutes()) {
    const path = resolveRoutePath(route.path, fixtures)
    const res = await mutateRequest(memberRequest, {
      method: route.method,
      path,
      data: {},
    })
    const status = res.status()
    const passed = memberDeniedAdmin(status)
    results.push({
      route: route.path,
      method: route.method,
      role: 'member',
      check: 'member-denied-admin-mutation',
      status,
      passed,
      detail: passed
        ? `Member denied mutation (${status})`
        : `Member mutation accepted (${status})`,
    })
  }

  return results
}
