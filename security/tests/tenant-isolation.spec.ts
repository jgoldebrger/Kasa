import { test, assertSecurityPassed } from '../playwright/fixtures'
import { activateOrganization, betaOrgName } from '../auth/roles'
import { testUiOrgIsolation } from '../helpers/tenant-isolation'

test.describe('Tenant isolation UI', () => {
  test('families list shows only active org data', async ({ authedPage }) => {
    await activateOrganization(authedPage, betaOrgName())
    const result = await testUiOrgIsolation(authedPage, 'Alpha Marker Family')
    assertSecurityPassed(
      result.test,
      'tenant-isolation',
      result.passed,
      result.detail,
      'critical',
    )
  })
})
