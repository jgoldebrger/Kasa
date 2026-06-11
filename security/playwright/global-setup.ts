import { getSecurityConfig } from '../config'
import { resetTrafficLog } from '../helpers/capture'
import { initReportRun } from '../reports/writer'

async function globalSetup(): Promise<void> {
  resetTrafficLog()
  initReportRun(`sec-${Date.now()}`)
  const sec = getSecurityConfig()

  console.log(`[security] Environment: ${sec.environment}`)
  console.log(`[security] Target: ${sec.baseUrl}`)
  if (sec.proxy.enabled) {
    console.log(`[security] Proxy: ${sec.proxy.server}`)
  }
  // Auth bootstrap runs in the sec-setup project after webServer is ready.
}

export default globalSetup
