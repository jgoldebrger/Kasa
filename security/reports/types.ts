export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface SecurityFinding {
  id: string
  title: string
  severity: Severity
  category: string
  passed: boolean
  detail: string
  evidence?: Record<string, unknown>
  timestamp: string
}

export interface SecurityReport {
  meta: {
    generatedAt: string
    environment: string
    baseUrl: string
    runId: string
    durationMs?: number
  }
  summary: {
    total: number
    passed: number
    failed: number
    critical: number
    high: number
  }
  findings: SecurityFinding[]
  traffic?: {
    requestCount: number
    responseCount: number
    sessionSnapshots: number
  }
  zap?: {
    enabled: boolean
    alerts?: unknown[]
  }
}

export function findingFromTest(opts: {
  title: string
  category: string
  passed: boolean
  detail: string
  severity?: Severity
  evidence?: Record<string, unknown>
}): SecurityFinding {
  return {
    id: `${opts.category}-${opts.title}`.replace(/\s+/g, '-').toLowerCase().slice(0, 80),
    title: opts.title,
    severity: opts.passed ? 'info' : (opts.severity ?? 'high'),
    category: opts.category,
    passed: opts.passed,
    detail: opts.detail,
    evidence: opts.evidence,
    timestamp: new Date().toISOString(),
  }
}

export function buildSummary(findings: SecurityFinding[]): SecurityReport['summary'] {
  const failed = findings.filter((f) => !f.passed)
  return {
    total: findings.length,
    passed: findings.filter((f) => f.passed).length,
    failed: failed.length,
    critical: failed.filter((f) => f.severity === 'critical').length,
    high: failed.filter((f) => f.severity === 'high').length,
  }
}
