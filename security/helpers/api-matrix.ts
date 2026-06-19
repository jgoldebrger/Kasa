import fs from 'fs'
import type { APIRequestContext } from '@playwright/test'
import { getCatalogRoutes, isProtectedRoute, routeKey, type ApiRouteEntry } from '../catalog'
import { authStoragePath } from '../auth/bootstrap'
import { getSecurityConfig } from '../config'
import { IDOR_SAFE_STATUSES } from '../payloads/idor-vectors'
import { NON_MEMBER_ORG_ID } from './idor'
import { mutateRequest, withOrgHeader } from './request-mutation'
import {
  defaultRouteFixtures,
  resolveRouteFixtures,
  resolveRoutePath,
  type RouteFixtureIds,
} from './route-fixtures'

export interface MatrixProbeResult {
  route: string
  method: string
  check: string
  status: number
  passed: boolean
  detail: string
}

const GUEST_OK_STATUSES = new Set([400, 401, 403, 307, 405])

/** Minimal body for mutating probes — CSRF runs before validation. */
function probeBody(route: ApiRouteEntry): unknown {
  if (route.method === 'GET' || route.method === 'HEAD' || route.method === 'DELETE') {
    return undefined
  }
  if (route.path.includes('/organizations') && route.method === 'PATCH') {
    return { activeOrgId: NON_MEMBER_ORG_ID }
  }
  if (route.path.includes('/user') && route.method === 'PATCH') {
    return { name: 'sec-matrix-probe' }
  }
  if (route.path.includes('/tasks')) {
    return { title: 'sec', email: 'm@t.invalid', priority: 'low' }
  }
  return {}
}

export async function probeGuestDenied(
  request: APIRequestContext,
  routes: ApiRouteEntry[],
  fixtures: RouteFixtureIds,
): Promise<MatrixProbeResult[]> {
  const results: MatrixProbeResult[] = []
  for (const route of routes) {
    if (!isProtectedRoute(route)) continue
    const path = resolveRoutePath(route.path, fixtures)
    const res = await mutateRequest(request, {
      method: route.method,
      path,
      data: probeBody(route),
      stripOrigin: false,
    })
    const status = res.status()
    const passed = GUEST_OK_STATUSES.has(status)
    results.push({
      route: route.path,
      method: route.method,
      check: 'guest-denied',
      status,
      passed,
      detail: passed
        ? `Guest denied (${status})`
        : `Guest unexpected access (${status}) on ${routeKey(route)}`,
    })
  }
  return results
}

export async function probeOwnerGetReachable(
  request: APIRequestContext,
  routes: ApiRouteEntry[],
  fixtures: RouteFixtureIds,
  opts?: { isPlatformAdmin: boolean },
): Promise<MatrixProbeResult[]> {
  const results: MatrixProbeResult[] = []
  for (const route of routes) {
    if (route.method !== 'GET') continue
    if (route.auth === 'cron' || route.auth === 'webhook' || route.auth === 'nextauth') continue
    if (route.auth === 'public') continue
    if (route.auth === 'platform-admin' && !opts?.isPlatformAdmin) continue

    const path = resolveRoutePath(route.path, fixtures)
    const res = await mutateRequest(request, { method: 'GET', path })
    const status = res.status()
    const passed = status !== 401 && status !== 403 && status < 500
    results.push({
      route: route.path,
      method: route.method,
      check: 'owner-get',
      status,
      passed,
      detail: passed
        ? `Owner GET → ${status}`
        : `Owner GET blocked/error (${status}) on ${routeKey(route)}`,
    })
  }
  return results
}

function ownerCookieHeader(): string {
  const state = JSON.parse(fs.readFileSync(authStoragePath('owner'), 'utf8')) as {
    cookies: Array<{ name: string; value: string; domain: string; path: string }>
  }
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

function resolveProbeUrl(url: string): string {
  const config = getSecurityConfig()
  const fullUrl = url.startsWith('http') ? url : `${config.baseUrl}${url}`
  const parsed = new URL(fullUrl)
  const base = new URL(config.baseUrl)
  if (parsed.origin !== base.origin) {
    throw new Error(`Refusing cross-origin probe URL: ${parsed.origin}`)
  }
  return fullUrl
}

/** Node fetch without Origin/Referer — Playwright injects those automatically. */
async function fetchWithoutOrigin(method: string, url: string, body?: unknown): Promise<number> {
  const fullUrl = resolveProbeUrl(url)
  const headers: Record<string, string> = {
    cookie: ownerCookieHeader(),
    'content-type': 'application/json',
  }
  const init: RequestInit = { method, headers }
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body)
  }
  const res = await fetch(fullUrl, init)
  return res.status
}

export async function probeCsrfMatrix(
  request: APIRequestContext,
  routes: ApiRouteEntry[],
  fixtures: RouteFixtureIds,
  vector: 'missing-origin' | 'evil-origin',
): Promise<MatrixProbeResult[]> {
  const results: MatrixProbeResult[] = []
  for (const route of routes) {
    if (!route.csrf) continue
    if (route.auth === 'nextauth' || route.auth === 'webhook' || route.auth === 'cron') continue
    const path = resolveRoutePath(route.path, fixtures)
    const body = probeBody(route)

    const status =
      vector === 'missing-origin'
        ? await fetchWithoutOrigin(route.method, path, body)
        : (
            await mutateRequest(request, {
              method: route.method,
              path,
              data: body,
              evilOrigin: 'https://evil-attacker.example',
            })
          ).status()

    const passed = status === 403
    results.push({
      route: route.path,
      method: route.method,
      check: `csrf-${vector}`,
      status,
      passed,
      detail: passed ? `CSRF blocked (${status})` : `CSRF failed (${status}) on ${routeKey(route)}`,
    })
  }
  return results
}

export async function probeTenantHeaderDenied(
  request: APIRequestContext,
  routes: ApiRouteEntry[],
  fixtures: RouteFixtureIds,
): Promise<MatrixProbeResult[]> {
  const results: MatrixProbeResult[] = []
  for (const route of routes) {
    if (route.method !== 'GET' || !route.tenantScoped) continue
    if (route.auth === 'platform-admin' || route.auth === 'admin' || route.auth === 'cron') {
      continue
    }

    const path = resolveRoutePath(route.path, fixtures)
    const res = await mutateRequest(request, {
      method: 'GET',
      path,
      headers: withOrgHeader(NON_MEMBER_ORG_ID),
    })
    const status = res.status()
    const passed = IDOR_SAFE_STATUSES.has(status)
    results.push({
      route: route.path,
      method: route.method,
      check: 'tenant-header',
      status,
      passed,
      detail: passed
        ? `Non-member org header → ${status}`
        : `Non-member org header accepted (${status}) on ${routeKey(route)}`,
    })
  }
  return results
}

export function loadMatrixRoutes(): ApiRouteEntry[] {
  return getCatalogRoutes()
}

export async function buildMatrixFixtures(request: APIRequestContext): Promise<RouteFixtureIds> {
  return resolveRouteFixtures(request)
}

export function buildGuestMatrixFixtures(): RouteFixtureIds {
  return defaultRouteFixtures()
}
