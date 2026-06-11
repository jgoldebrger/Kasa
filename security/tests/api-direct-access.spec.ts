import { test, assertSecurityPassed } from '../playwright/fixtures'
import {
  testPageAuthRedirect,
  testUnauthenticatedAccess,
} from '../helpers/auth-testing'
import { probeGraphQLExposure } from '../helpers/graphql'
import { findingFromTest, recordFindings } from '../reports/writer'

const PROTECTED_API = [
  '/api/families',
  '/api/payments',
  '/api/tasks',
  '/api/user',
  '/api/organizations',
  '/api/dashboard-stats',
]

const PROTECTED_PAGES = ['/families', '/settings', '/account', '/tasks']

test.describe('Insecure direct API access', () => {
  test('protected APIs reject unauthenticated requests @guest-only', async ({ guestRequest }) => {
    const results = await testUnauthenticatedAccess(guestRequest, PROTECTED_API)
    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: r.test,
          category: 'auth-bypass',
          passed: r.passed,
          detail: r.detail,
          severity: 'critical',
        }),
      ),
    )
    for (const r of results) {
      assertSecurityPassed(r.test, 'auth-bypass', r.passed, r.detail, 'critical')
    }
  })

  test('protected pages redirect to login @guest-only', async ({ guestContext }) => {
    const page = await guestContext.newPage()
    const results = await testPageAuthRedirect(page, PROTECTED_PAGES)
    for (const r of results) {
      assertSecurityPassed(r.test, 'auth-bypass', r.passed, r.detail, 'high')
    }
  })

  test('GraphQL endpoints are not exposed @guest-only', async ({ guestRequest }) => {
    const results = await probeGraphQLExposure(guestRequest)
    for (const r of results) {
      assertSecurityPassed(r.test, 'auth-bypass', r.passed, r.detail, 'medium')
    }
  })

  test('cron jobs reject missing secret @guest-only', async ({ guestRequest }) => {
    const res = await guestRequest.post('/api/jobs/process-recurring-payments')
    const passed = res.status() === 401 || res.status() === 403
    assertSecurityPassed(
      'cron without secret',
      'auth-bypass',
      passed,
      `Cron endpoint → ${res.status()}`,
      'critical',
    )
  })
})
