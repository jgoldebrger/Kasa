import { test, assertSecurityPassed } from '../playwright/fixtures'
import { runUploadAbuseSuite } from '../helpers/upload'
import { runDefaultFuzzSuite } from '../helpers/api-fuzzing'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('Upload abuse', () => {
  test('import and email attachment endpoints reject abuse', async ({ ownerContext, secConfig }) => {
    test.skip(!secConfig.allowDestructive, 'Upload abuse tests disabled')

    const results = await runUploadAbuseSuite(ownerContext.request)
    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: r.test,
          category: 'upload',
          passed: r.passed,
          detail: r.detail,
          severity: 'high',
        }),
      ),
    )
    for (const r of results) {
      assertSecurityPassed(r.test, 'upload', r.passed, r.detail, 'high')
    }
  })
})

test.describe('API fuzzing', () => {
  test('default fuzz suite does not cause server errors', async ({ ownerContext, secConfig }) => {
    test.skip(!secConfig.allowDestructive, 'Fuzz tests disabled')

    const results = await runDefaultFuzzSuite(ownerContext.request)
    const failures = results.filter((r) => !r.passed)
    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: `fuzz ${r.endpoint}`,
          category: 'fuzzing',
          passed: r.passed,
          detail: r.detail,
          severity: 'medium',
        }),
      ),
    )
    assertSecurityPassed(
      'no 500 on fuzz',
      'fuzzing',
      failures.length === 0,
      failures.length ? `${failures.length} endpoints returned 500` : 'All fuzz probes handled',
    )
  })
})
