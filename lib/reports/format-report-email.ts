import type { ReportResult } from '@/lib/report-builder'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'
}

/** Render a pivot result as a simple HTML table for email bodies. */
export function formatReportResultHtml(
  reportName: string,
  result: ReportResult,
  opts?: { generatedAt?: Date },
): string {
  const generatedAt = opts?.generatedAt ?? new Date()
  const colLabels = result.colLabels.length > 0 ? result.colLabels : ['Value']

  const headerCells = ['', ...colLabels, 'Total']
    .map(
      (h) =>
        `<th style="padding:6px 10px;border:1px solid #ddd;text-align:${h ? 'right' : 'left'};background:#f5f5f5;">${escapeHtml(h)}</th>`,
    )
    .join('')

  const bodyRows = result.rowLabels
    .map((rl) => {
      const cells = result.colLabels.map(
        (cl) =>
          `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmtNumber(result.values[rl]?.[cl] ?? 0)}</td>`,
      )
      const total = fmtNumber(result.totals.rows[rl] ?? 0)
      return `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(rl)}</td>${cells.join('')}<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:600;">${total}</td></tr>`
    })
    .join('')

  const footerCells = result.colLabels
    .map(
      (cl) =>
        `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:600;">${fmtNumber(result.totals.cols[cl] ?? 0)}</td>`,
    )
    .join('')

  const table =
    result.rowLabels.length === 0
      ? '<p style="color:#666;">No rows matched this report configuration.</p>'
      : `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;width:100%;max-width:720px;">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600;">Total</td>${footerCells}<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:600;">${fmtNumber(result.totals.grand)}</td></tr></tfoot>
    </table>`

  return `<div style="font-family:sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(reportName)}</h2>
    <p style="margin:0 0 16px;color:#666;font-size:12px;">Generated ${generatedAt.toLocaleString('en-US')} · ${result.rowCount.toLocaleString()} source rows</p>
    ${table}
  </div>`
}
