import fs from 'fs'
import path from 'path'
import type { SecurityFinding, SecurityReport } from './types'
import { buildSummary } from './types'
import { writeHtmlReport, writeJsonReport } from './html-reporter'
import { getSecurityConfig } from '../config'

export { writeJsonReport } from './html-reporter'
export * from './types'

const globalFindings: SecurityFinding[] = []
let runStartedAt = Date.now()
let runId: string | null = null

function runIdFile(): string {
  return path.join(getSecurityConfig().reportDir, '.current-run-id')
}

function resolveRunId(): string {
  if (runId) return runId
  const idFile = runIdFile()
  if (fs.existsSync(idFile)) {
    runId = fs.readFileSync(idFile, 'utf8').trim()
    return runId
  }
  runId = `run-${Date.now()}`
  return runId
}

function findingsBufferPath(): string {
  const dir = getSecurityConfig().reportDir
  return path.join(dir, `.findings-${resolveRunId()}.jsonl`)
}

export function initReportRun(id?: string): void {
  globalFindings.length = 0
  runStartedAt = Date.now()
  runId = id ?? `run-${Date.now()}`
  const dir = getSecurityConfig().reportDir
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(runIdFile(), runId, 'utf8')
  const buffer = findingsBufferPath()
  if (fs.existsSync(buffer)) fs.unlinkSync(buffer)
}

export function recordFinding(finding: SecurityFinding): void {
  globalFindings.push(finding)
  fs.appendFileSync(findingsBufferPath(), `${JSON.stringify(finding)}\n`, 'utf8')
}

export function recordFindings(findings: SecurityFinding[]): void {
  for (const f of findings) recordFinding(f)
}

function loadPersistedFindings(): SecurityFinding[] {
  const buffer = findingsBufferPath()
  if (!fs.existsSync(buffer)) return [...globalFindings]
  return fs
    .readFileSync(buffer, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SecurityFinding)
}

export function getRecordedFindings(): SecurityFinding[] {
  return loadPersistedFindings()
}

export function finalizeReport(opts: {
  environment: string
  baseUrl: string
  reportDir: string
  traffic?: SecurityReport['traffic']
  zap?: SecurityReport['zap']
}): { jsonPath: string; htmlPath: string; report: SecurityReport } {
  const findings = loadPersistedFindings()
  const report: SecurityReport = {
    meta: {
      generatedAt: new Date().toISOString(),
      environment: opts.environment,
      baseUrl: opts.baseUrl,
      runId: resolveRunId(),
      durationMs: Date.now() - runStartedAt,
    },
    summary: buildSummary(findings),
    findings,
    traffic: opts.traffic,
    zap: opts.zap,
  }

  const jsonPath = writeJsonReport(report, opts.reportDir)
  const htmlPath = writeHtmlReport(report, opts.reportDir)
  const buffer = findingsBufferPath()
  if (fs.existsSync(buffer)) fs.unlinkSync(buffer)
  if (fs.existsSync(runIdFile())) fs.unlinkSync(runIdFile())
  return { jsonPath, htmlPath, report }
}
