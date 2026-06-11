import fs from 'fs'
import path from 'path'
import type { SecurityReport } from './types'

export function writeJsonReport(report: SecurityReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `security-report-${report.meta.runId}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
  return file
}

export function writeHtmlReport(report: SecurityReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `security-report-${report.meta.runId}.html`)
  const rows = report.findings
    .map(
      (f) => `
    <tr class="${f.passed ? 'pass' : 'fail'}">
      <td>${escapeHtml(f.severity)}</td>
      <td>${escapeHtml(f.category)}</td>
      <td>${escapeHtml(f.title)}</td>
      <td>${f.passed ? 'PASS' : 'FAIL'}</td>
      <td>${escapeHtml(f.detail)}</td>
    </tr>`,
    )
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Security Report ${escapeHtml(report.meta.runId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
    h1 { color: #f8fafc; }
    .meta { color: #94a3b8; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #334155; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #1e293b; }
    tr.fail { background: #450a0a; }
    tr.pass { background: #052e16; }
    .summary { display: flex; gap: 1rem; margin: 1rem 0; }
    .card { background: #1e293b; padding: 1rem; border-radius: 8px; min-width: 120px; }
    .card strong { font-size: 1.5rem; display: block; }
  </style>
</head>
<body>
  <h1>KASA Security Test Report</h1>
  <div class="meta">
    <div>Environment: ${escapeHtml(report.meta.environment)}</div>
    <div>Target: ${escapeHtml(report.meta.baseUrl)}</div>
    <div>Generated: ${escapeHtml(report.meta.generatedAt)}</div>
  </div>
  <div class="summary">
    <div class="card"><strong>${report.summary.total}</strong>Total</div>
    <div class="card"><strong>${report.summary.passed}</strong>Passed</div>
    <div class="card"><strong>${report.summary.failed}</strong>Failed</div>
    <div class="card"><strong>${report.summary.critical}</strong>Critical</div>
    <div class="card"><strong>${report.summary.high}</strong>High</div>
  </div>
  <table>
    <thead><tr><th>Severity</th><th>Category</th><th>Test</th><th>Result</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`

  fs.writeFileSync(file, html, 'utf8')
  return file
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
