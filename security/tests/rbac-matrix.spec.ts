import { test, expect, assertSecurityPassed } from '../playwright/fixtures'
import {
  probeMemberAllowedRoutes,
  probeMemberDeniedAdminMutations,
  probeMemberDeniedAdminRoutes,
  probeOwnerAdminRoutes,
} from '../helpers/rbac-matrix'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe.configure({ timeout: 300_000 })

test.describe('RBAC role matrix @member-rbac', () => {
  test('org member cannot access admin-only routes', async ({ memberContext }) => {
    const results = await probeMemberDeniedAdminRoutes(memberContext.request)
    const failures = results.filter((r) => !r.passed)
    recordFindings(
      failures.map((r) =>
        findingFromTest({
          title: `${r.check} ${r.method} ${r.route}`,
          category: 'rbac',
          passed: r.passed,
          detail: r.detail,
          severity: 'critical',
        }),
      ),
    )
    assertSecurityPassed(
      'member denied admin routes',
      'rbac',
      failures.length === 0,
      failures.length
        ? `${failures.length} admin routes exposed: ${failures
            .map((f) => `${f.method} ${f.route}→${f.status}`)
            .join(', ')}`
        : `All ${results.length} admin probes denied for member`,
      'critical',
    )
  })

  test('org member cannot run admin mutations', async ({ memberContext }) => {
    const results = await probeMemberDeniedAdminMutations(memberContext.request)
    const failures = results.filter((r) => !r.passed)
    assertSecurityPassed(
      'member denied admin mutations',
      'rbac',
      failures.length === 0,
      failures.length
        ? `Member accepted mutations: ${failures
            .map((f) => `${f.method} ${f.route}→${f.status}`)
            .join(', ')}`
        : `All ${results.length} admin mutations denied`,
      'critical',
    )
  })

  test('org member can access member-level routes', async ({ memberContext }) => {
    const results = await probeMemberAllowedRoutes(memberContext.request)
    const failures = results.filter((r) => !r.passed)
    assertSecurityPassed(
      'member allowed routes',
      'rbac',
      failures.length === 0,
      failures.length
        ? `Member blocked from ${failures.length} member routes`
        : `All ${results.length} member routes reachable`,
    )
  })

  test('org owner can access admin routes', async ({ ownerContext }) => {
    const results = await probeOwnerAdminRoutes(ownerContext.request)
    const failures = results.filter((r) => !r.passed)
    assertSecurityPassed(
      'owner admin routes',
      'rbac',
      failures.length === 0,
      failures.length
        ? `Owner denied ${failures.length} admin routes`
        : `Owner reached ${results.length} admin probes`,
    )
  })
})
