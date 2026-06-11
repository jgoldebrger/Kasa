import { test, assertSecurityPassed } from '../playwright/fixtures'
import { testEvilOriginBlocked, testMissingOriginBlocked } from '../helpers/csrf'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('CSRF protection', () => {
  test('state-changing requests without Origin are blocked', async ({ ownerContext }) => {
    const results = await testMissingOriginBlocked(ownerContext.request)
    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: `${r.method} ${r.endpoint} missing origin`,
          category: 'csrf',
          passed: r.passed,
          detail: r.detail,
          severity: 'high',
        }),
      ),
    )
    for (const r of results) {
      assertSecurityPassed(`${r.method} ${r.endpoint}`, 'csrf', r.passed, r.detail, 'high')
    }
  })

  test('cross-site Origin is blocked', async ({ ownerContext }) => {
    const results = await testEvilOriginBlocked(ownerContext.request)
    for (const r of results) {
      assertSecurityPassed(`${r.method} ${r.endpoint}`, 'csrf', r.passed, r.detail, 'high')
    }
  })
})
