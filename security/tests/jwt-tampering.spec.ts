import { test, assertSecurityPassed } from '../playwright/fixtures'
import { testEncryptedSessionTampering } from '../helpers/jwt-session'
import {
  testJwtOrSessionRequired,
  testSessionTampering,
} from '../helpers/auth-testing'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('JWT / session integrity', () => {
  test('tampered session cookies are rejected', async ({ ownerContext }) => {
    const results = await testEncryptedSessionTampering(ownerContext)
    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: r.test,
          category: 'session',
          passed: r.passed,
          detail: r.detail,
          severity: 'critical',
        }),
      ),
    )
    for (const r of results) {
      assertSecurityPassed(r.test, 'session', r.passed, r.detail, 'critical')
    }
  })

  test('cleared session cannot access protected APIs', async ({ ownerContext }) => {
    const results = await testJwtOrSessionRequired(ownerContext, [
      '/api/user',
      '/api/families',
      '/api/audit-log?limit=1',
    ])
    for (const r of results) {
      assertSecurityPassed(r.test, 'session', r.passed, r.detail, 'critical')
    }
  })

  test('session tampering via context API', async ({ ownerContext }) => {
    const results = await testSessionTampering(ownerContext, '/api/user')
    for (const r of results) {
      assertSecurityPassed(r.test, 'session', r.passed, r.detail, 'critical')
    }
  })
})
