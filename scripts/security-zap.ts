#!/usr/bin/env npx tsx
/**
 * OWASP ZAP Docker helpers for the security test suite.
 *
 *   npm run security:zap:up        — start ZAP daemon container
 *   npm run security:zap:baseline  — passive baseline scan
 *   npm run security:zap:full      — active full scan (authorized targets only)
 *   npm run security:zap:down      — stop container
 */
import { getSecurityConfig } from '../security/config'
import {
  runZapBaseline,
  runZapFullScan,
  startZapDocker,
  stopZapDocker,
} from '../security/scanners/zap-docker'

const cmd = process.argv[2] ?? 'up'

async function main(): Promise<void> {
  const config = getSecurityConfig()
  switch (cmd) {
    case 'up':
      await startZapDocker({ targetUrl: config.baseUrl })
      break
    case 'baseline':
      console.log(`[security:zap] Baseline scan → ${config.baseUrl}`)
      const baselineReport = await runZapBaseline(config.baseUrl)
      console.log(
        baselineReport
          ? `[security:zap] Report: ${baselineReport}`
          : '[security:zap] Baseline failed',
      )
      process.exit(baselineReport ? 0 : 1)
    case 'full':
      console.log(`[security:zap] Full (active) scan → ${config.baseUrl}`)
      const full = await runZapFullScan(config.baseUrl, {
        maxDurationMins: Number(process.env.SECURITY_ZAP_FULL_MINS || '15'),
      })
      console.log(
        full.reportPath
          ? `[security:zap] Report: ${full.reportPath} (exit ${full.exitCode})`
          : '[security:zap] Full scan failed',
      )
      process.exit(full.reportPath ? 0 : 1)
    case 'down':
      stopZapDocker()
      console.log('[security:zap] Container stopped')
      break
    default:
      console.error('Usage: security-zap.ts [up|baseline|full|down]')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
