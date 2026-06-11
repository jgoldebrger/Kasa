import { test, expect, assertSecurityPassed } from '../playwright/fixtures'
import { loadApiRouteCatalog } from '../catalog'
import {
  buildGuestMatrixFixtures,
  buildMatrixFixtures,
  loadMatrixRoutes,
  probeCsrfMatrix,
  probeGuestDenied,
  probeOwnerGetReachable,
  probeTenantHeaderDenied,
} from '../helpers/api-matrix'
import { findingFromTest, recordFindings } from '../reports/writer'
import { E2E_USER } from '../../e2e/seed'

test.describe.configure({ mode: 'serial', timeout: 600_000 })

test.describe('API route matrix (full catalog)', () => {
  test('catalog is present and current', async () => {
    const catalog = loadApiRouteCatalog()
    expect(catalog.routes.length).toBeGreaterThan(100)
    expect(catalog.summary.total).toBe(catalog.routes.length)
    console.log(
      `[security:catalog] ${catalog.summary.total} routes, ${catalog.summary.mutating} mutating, generated ${catalog.generatedAt}`,
    )
  })

  test('every protected route rejects unauthenticated access @guest-only', async ({
    guestRequest,
  }) => {
    const routes = loadMatrixRoutes()
    const fixtures = buildGuestMatrixFixtures()
    const results = await probeGuestDenied(guestRequest, routes, fixtures)
    const failures = results.filter((r) => !r.passed)

    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: `${r.check} ${r.method} ${r.route}`,
          category: 'api-matrix',
          passed: r.passed,
          detail: r.detail,
          severity: 'critical',
        }),
      ),
    )

    assertSecurityPassed(
      'guest denied on all protected routes',
      'api-matrix',
      failures.length === 0,
      failures.length
        ? `${failures.length} routes exposed to guest: ${failures
            .slice(0, 5)
            .map((f) => `${f.method} ${f.route}→${f.status}`)
            .join(', ')}`
        : `All ${results.length} protected probes denied`,
      'critical',
    )
  })

  test('owner can reach org/session GET endpoints', async ({ ownerContext, secConfig }) => {
    const routes = loadMatrixRoutes()
    const fixtures = await buildMatrixFixtures(ownerContext.request)
    const isPlatformAdmin =
      secConfig.owner.email.toLowerCase() === E2E_USER.email.toLowerCase() &&
      secConfig.environment === 'local'

    const results = await probeOwnerGetReachable(
      ownerContext.request,
      routes,
      fixtures,
      { isPlatformAdmin },
    )
    const failures = results.filter((r) => !r.passed)

    recordFindings(
      failures.slice(0, 50).map((r) =>
        findingFromTest({
          title: `${r.check} ${r.method} ${r.route}`,
          category: 'api-matrix',
          passed: r.passed,
          detail: r.detail,
          severity: 'high',
        }),
      ),
    )

    assertSecurityPassed(
      'owner GET matrix',
      'api-matrix',
      failures.length === 0,
      failures.length
        ? `${failures.length}/${results.length} GET routes failed for owner`
        : `${results.length} GET routes reachable or safely 4xx`,
    )
  })

  test('mutating routes block missing Origin (CSRF)', async ({ ownerContext }) => {
    const routes = loadMatrixRoutes()
    const fixtures = await buildMatrixFixtures(ownerContext.request)
    const results = await probeCsrfMatrix(
      ownerContext.request,
      routes,
      fixtures,
      'missing-origin',
    )
    const failures = results.filter((r) => !r.passed)

    recordFindings(
      failures.slice(0, 50).map((r) =>
        findingFromTest({
          title: `csrf-missing ${r.method} ${r.route}`,
          category: 'api-matrix',
          passed: r.passed,
          detail: r.detail,
          severity: 'high',
        }),
      ),
    )

    assertSecurityPassed(
      'CSRF missing-origin matrix',
      'api-matrix',
      failures.length === 0,
      failures.length
        ? `${failures.length}/${results.length} failed: ${failures
            .map((f) => `${f.method} ${f.route}→${f.status}`)
            .join(', ')}`
        : `${results.length} mutating routes CSRF-protected`,
      'high',
    )
  })

  test('mutating routes block cross-site Origin (CSRF)', async ({ ownerContext }) => {
    const routes = loadMatrixRoutes()
    const fixtures = await buildMatrixFixtures(ownerContext.request)
    const results = await probeCsrfMatrix(
      ownerContext.request,
      routes,
      fixtures,
      'evil-origin',
    )
    const failures = results.filter((r) => !r.passed)

    assertSecurityPassed(
      'CSRF evil-origin matrix',
      'api-matrix',
      failures.length === 0,
      failures.length
        ? `${failures.length}/${results.length} routes accepted evil Origin`
        : `${results.length} mutating routes CSRF-protected`,
      'high',
    )
  })

  test('tenant-scoped GET routes reject non-member org header', async ({ ownerContext }) => {
    const routes = loadMatrixRoutes()
    const fixtures = await buildMatrixFixtures(ownerContext.request)
    const results = await probeTenantHeaderDenied(ownerContext.request, routes, fixtures)
    const failures = results.filter((r) => !r.passed)

    assertSecurityPassed(
      'tenant header matrix',
      'api-matrix',
      failures.length === 0,
      failures.length
        ? `${failures.length}/${results.length} routes accepted spoofed org`
        : `${results.length} tenant GET routes rejected non-member org`,
      'critical',
    )
  })
})
