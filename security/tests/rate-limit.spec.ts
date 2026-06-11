import { test, assertSecurityPassed } from '../playwright/fixtures'
import { testRateLimitConcurrency } from '../helpers/rate-limit'
import { findingFromTest, recordFindings } from '../reports/writer'

test.describe('Rate limit abuse', () => {
  test('search API rate limits burst traffic', async ({ ownerContext, secConfig }) => {
    test.setTimeout(120_000)
    const result = await testRateLimitConcurrency(
      ownerContext.request,
      '/api/search?q=ratelimit',
      { workers: secConfig.concurrency.rateLimitWorkers, total: secConfig.concurrency.rateLimitBurst },
    )
    recordFindings([
      findingFromTest({
        title: 'search burst rate limit',
        category: 'rate-limit',
        passed: result.passed,
        detail: result.detail,
        severity: 'medium',
        evidence: { histogram: result.statusHistogram },
      }),
    ])
    assertSecurityPassed(
      'search rate limit',
      'rate-limit',
      result.passed,
      result.detail,
      'medium',
    )
  })
})
