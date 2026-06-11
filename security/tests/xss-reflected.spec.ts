import { test, assertSecurityPassed } from '../playwright/fixtures'
import { probeReflectedXss } from '../helpers/xss'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('Reflected XSS', () => {
  test('search API does not reflect dangerous payloads', async ({ ownerContext }) => {
    const request = ownerContext.request
    const results = await probeReflectedXss(request, [
      { path: '/api/search', param: 'q' },
    ])

    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: `reflected-xss ${r.vector}`,
          category: 'xss',
          passed: r.passed,
          detail: r.detail,
          severity: 'high',
          evidence: { payload: r.payload },
        }),
      ),
    )

    for (const r of results) {
      assertSecurityPassed(`reflected ${r.vector}`, 'xss', r.passed, r.detail, 'high')
    }
  })

  test('welcome page query params are sanitized @guest-only', async ({ guestContext }) => {
    const page = await guestContext.newPage()
    await page.goto('/welcome?msg=%3Cscript%3Ealert(1)%3C/script%3E')
    const html = await page.content()
    const passed = !html.includes('<script>alert(1)</script>')
    assertSecurityPassed(
      'welcome query param XSS',
      'xss',
      passed,
      passed ? 'Script not reflected' : 'Script reflected in welcome page',
      'high',
    )
  })
})
