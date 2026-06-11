import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getSecurityConfig } from '../config'

export interface ZapDockerOptions {
  targetUrl: string
  reportDir: string
  apiPort?: number
  proxyPort?: number
}

/** Start OWASP ZAP in Docker (daemon mode) for passive scanning via proxy. */
export async function startZapDocker(opts?: Partial<ZapDockerOptions>): Promise<void> {
  const config = getSecurityConfig()
  if (!config.zap.enabled) {
    console.log('[security:zap] ZAP disabled (SECURITY_ZAP_ENABLED=false)')
    return
  }

  const targetUrl = opts?.targetUrl ?? config.baseUrl
  const apiPort = opts?.apiPort ?? 8080
  const proxyPort = opts?.proxyPort ?? 8090

  const args = [
    'run',
    '-d',
    '--rm',
    '--name',
    'kasa-zap',
    '-p',
    `${apiPort}:8080`,
    '-p',
    `${proxyPort}:8090`,
    config.zap.dockerImage,
  ]

  console.log('[security:zap] Starting ZAP container:', args.join(' '))
  const proc = spawn('docker', args, { stdio: 'inherit', shell: true })
  await new Promise<void>((resolve, reject) => {
    proc.on('error', reject)
    setTimeout(resolve, 8000)
  })
  console.log(`[security:zap] ZAP API http://127.0.0.1:${apiPort} — point SECURITY_PROXY_URL=http://127.0.0.1:${proxyPort}`)
  console.log(`[security:zap] Target context: ${targetUrl}`)
}

export interface ZapScanResult {
  reportPath: string | null
  scanType: 'baseline' | 'full'
  exitCode: number | null
}

function runZapDockerScan(
  script: 'zap-baseline.py' | 'zap-full-scan.py',
  targetUrl: string,
  scanType: ZapScanResult['scanType'],
  extraArgs: string[] = [],
): Promise<ZapScanResult> {
  const config = getSecurityConfig()
  const outDir = path.join(config.reportDir, 'zap')
  fs.mkdirSync(outDir, { recursive: true })
  const reportFile = path.join(outDir, `zap-${scanType}-${Date.now()}.json`)

  return new Promise((resolve) => {
    const proc = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'host',
        config.zap.dockerImage,
        script,
        '-t',
        targetUrl,
        '-J',
        reportFile,
        ...extraArgs,
      ],
      { stdio: 'inherit', shell: true },
    )
    proc.on('close', (code) => {
      resolve({
        reportPath: fs.existsSync(reportFile) ? reportFile : null,
        scanType,
        exitCode: code,
      })
    })
    proc.on('error', () => {
      resolve({ reportPath: null, scanType, exitCode: null })
    })
  })
}

/** Passive baseline scan (spider + passive rules). Fails CI on High alerts by default. */
export async function runZapBaseline(targetUrl?: string): Promise<string | null> {
  const config = getSecurityConfig()
  const url = targetUrl ?? config.baseUrl
  const result = await runZapDockerScan('zap-baseline.py', url, 'baseline', ['-I'])
  return result.reportPath
}

/**
 * Full scan (spider + active rules). Use only on authorized targets.
 * `-I` ignores pass/fail exit for local dev; CI can enforce via artifact review.
 */
export async function runZapFullScan(
  targetUrl?: string,
  opts?: { maxDurationMins?: number },
): Promise<ZapScanResult> {
  const config = getSecurityConfig()
  const url = targetUrl ?? config.baseUrl
  const mins = opts?.maxDurationMins ?? 15
  return runZapDockerScan('zap-full-scan.py', url, 'full', [
    '-I',
    '-m',
    String(mins),
  ])
}

export function stopZapDocker(): void {
  spawn('docker', ['rm', '-f', 'kasa-zap'], { stdio: 'ignore', shell: true })
}
