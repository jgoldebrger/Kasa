import type { FullConfig } from '@playwright/test'
import { getSecurityConfig } from '../config'
import { getTrafficLog, resetTrafficLog } from '../helpers/capture'
import { finalizeReport } from '../reports/writer'

async function globalTeardown(_config: FullConfig): Promise<void> {
  const sec = getSecurityConfig()
  const traffic = getTrafficLog()

  const { jsonPath, htmlPath, report } = finalizeReport({
    environment: sec.environment,
    baseUrl: sec.baseUrl,
    reportDir: sec.reportDir,
    traffic: {
      requestCount: traffic.requests.length,
      responseCount: traffic.responses.length,
      sessionSnapshots: traffic.sessions.length,
    },
    zap: { enabled: sec.zap.enabled },
  })

  console.log(`[security] Report JSON: ${jsonPath}`)
  console.log(`[security] Report HTML: ${htmlPath}`)
  console.log(
    `[security] Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`,
  )

  resetTrafficLog()
}

export default globalTeardown
