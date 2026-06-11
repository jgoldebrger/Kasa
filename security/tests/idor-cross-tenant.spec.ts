import { test, assertSecurityPassed } from '../playwright/fixtures'
import {
  resolveCrossTenantFixture,
  runTenantIsolationBattery,
} from '../helpers/tenant-isolation'
import { NON_MEMBER_ORG_ID, testOrgHeaderSpoofing } from '../helpers/idor'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('IDOR & cross-tenant isolation', () => {
  test('foreign family IDs denied when scoped to home org', async ({ ownerContext }) => {
    const request = ownerContext.request
    const fixture = await resolveCrossTenantFixture(request)
    test.skip(!fixture, 'Cross-tenant fixture unavailable — seed Alpha/Beta orgs')

    const results = await runTenantIsolationBattery(request, fixture!)
    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: r.test,
          category: 'idor',
          passed: r.passed,
          detail: r.detail,
          severity: 'critical',
        }),
      ),
    )

    for (const r of results) {
      assertSecurityPassed(r.test, 'idor', r.passed, r.detail, 'critical')
    }
  })

  test('spoofed x-organization-id to non-member org is rejected', async ({ ownerContext }) => {
    const request = ownerContext.request
    const result = await testOrgHeaderSpoofing(request, NON_MEMBER_ORG_ID, '/api/families')
    assertSecurityPassed(
      'org header spoof',
      'idor',
      result.passed,
      result.detail,
      'critical',
    )
  })
})
