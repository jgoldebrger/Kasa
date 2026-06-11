import type { APIRequestContext, Page } from '@playwright/test'
import { alphaOrgName, betaOrgName, getOrgByName } from '../auth/roles'
import { testCrossTenantResourceAccess, type CrossTenantFixture } from './idor'
import { mutateRequest, withOrgHeader } from './request-mutation'

export interface TenantIsolationResult {
  test: string
  passed: boolean
  detail: string
}

export async function resolveCrossTenantFixture(
  request: APIRequestContext,
): Promise<CrossTenantFixture | null> {
  const alpha = await getOrgByName(request, alphaOrgName())
  const beta = await getOrgByName(request, betaOrgName())
  if (!alpha || !beta) return null

  const alphaSearch = await mutateRequest(request, {
    method: 'GET',
    path: `/api/search?q=${encodeURIComponent('Alpha Marker')}`,
    headers: withOrgHeader(alpha.id),
  })
  const betaSearch = await mutateRequest(request, {
    method: 'GET',
    path: `/api/search?q=${encodeURIComponent('Beta Marker')}`,
    headers: withOrgHeader(beta.id),
  })

  if (!alphaSearch.ok() || !betaSearch.ok()) return null

  const alphaItems = ((await alphaSearch.json()) as { items?: Array<{ type: string; id: string }> })
    .items
  const betaItems = ((await betaSearch.json()) as { items?: Array<{ type: string; id: string }> })
    .items

  const alphaFamily = alphaItems?.find((i) => i.type === 'family')
  const betaFamily = betaItems?.find((i) => i.type === 'family')
  if (!alphaFamily || !betaFamily) return null

  return {
    homeOrgId: alpha.id,
    foreignOrgId: beta.id,
    homeResourceId: alphaFamily.id,
    foreignResourceId: betaFamily.id,
  }
}

export async function runTenantIsolationBattery(
  request: APIRequestContext,
  fixture: CrossTenantFixture,
): Promise<TenantIsolationResult[]> {
  const results: TenantIsolationResult[] = []

  const idorPaths = [
    '/api/families/{id}',
    '/api/families/{id}/members',
    '/api/families/{id}/payments',
  ]

  for (const tmpl of idorPaths) {
    const r = await testCrossTenantResourceAccess(request, fixture, tmpl)
    results.push({
      test: `cross-tenant ${tmpl}`,
      passed: r.passed,
      detail: r.detail,
    })
  }

  // List endpoint should not include foreign org data when scoped to alpha
  const list = await mutateRequest(request, {
    method: 'GET',
    path: '/api/families',
    headers: withOrgHeader(fixture.homeOrgId),
  })
  if (list.ok()) {
    const families = await list.json()
    const names = Array.isArray(families)
      ? families.map((f: { name?: string }) => f.name)
      : []
    const leaked = names.some((n: string | undefined) => n?.includes('Beta Marker'))
    results.push({
      test: 'family list tenant scope',
      passed: !leaked,
      detail: leaked ? 'Beta Marker visible in Alpha org list' : 'List scoped to active org',
    })
  }

  return results
}

export async function testUiOrgIsolation(
  page: Page,
  foreignFamilyName: string,
): Promise<TenantIsolationResult> {
  await page.goto('/families')
  const visible = await page.getByText(foreignFamilyName).count()
  return {
    test: 'UI org isolation on /families',
    passed: visible === 0,
    detail:
      visible === 0
        ? 'Foreign org family not visible in UI'
        : `Foreign family "${foreignFamilyName}" visible (${visible} matches)`,
  }
}
