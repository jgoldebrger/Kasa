import { test, assertSecurityPassed } from '../playwright/fixtures'
import { probeStoredXssViaTask } from '../helpers/xss'
import { XSS_CANARY } from '../payloads/xss'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('Stored XSS', () => {
  test('task creation sanitizes stored HTML', async ({ ownerContext, secConfig }) => {
    test.skip(!secConfig.allowDestructive, 'Destructive tests disabled for this environment')

    const result = await probeStoredXssViaTask(ownerContext.request, XSS_CANARY)
    recordFindings([
      findingFromTest({
        title: 'stored-xss task',
        category: 'xss',
        passed: result.passed,
        detail: result.detail,
        severity: 'critical',
      }),
    ])
    assertSecurityPassed('stored XSS via task', 'xss', result.passed, result.detail, 'critical')
  })
})
