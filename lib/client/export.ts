'use client'

/**
 * Client-side CSV + XLSX export helpers used by <DataView>.
 *
 * - CSV is hand-rolled (RFC 4180 quoting) — zero deps.
 * - XLSX dynamically imports `exceljs` so the ~280 KB library never ships in
 *   the main bundle; it's loaded only when a user clicks "Export → Excel".
 *
 * Both helpers run entirely in the browser and trigger a Blob download.
 */

import type { ReactNode } from 'react'

export interface ExportColumn<T> {
  id: string
  /** Plain-text label used as the column header in the file. */
  label: string
  /** Returns the raw value for the cell. Dates stay as Dates so xlsx formats them. */
  value: (row: T) => string | number | Date | null | undefined | boolean
}

/* ─────────────────────────  Generic helpers  ───────────────────────── */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function formatCellForCsv(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return String(v)
}

function csvEscape(v: string): string {
  // RFC 4180: wrap in quotes if value contains quote, comma, CR or LF.
  if (/[",\r\n]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"'
  }
  return v
}

/* ─────────────────────────────  CSV  ───────────────────────────────── */

export function exportToCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]): void {
  const header = columns.map((c) => csvEscape(c.label)).join(',')
  const body = rows
    .map((row) => columns.map((c) => csvEscape(formatCellForCsv(c.value(row)))).join(','))
    .join('\r\n')
  // BOM so Excel opens UTF-8 properly.
  const csv = '\uFEFF' + header + '\r\n' + body
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), withExt(filename, 'csv'))
}

/* ─────────────────────────────  XLSX  ──────────────────────────────── */

export async function exportToXlsx<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[],
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kasa'
  wb.created = new Date()
  const ws = wb.addWorksheet('Sheet1', { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.columns = columns.map((c) => ({ header: c.label, key: c.id, width: 18 }))

  for (const row of rows) {
    const r: Record<string, unknown> = {}
    for (const c of columns) {
      const v = c.value(row)
      r[c.id] = v === undefined ? null : v
    }
    ws.addRow(r)
  }

  // Auto-size columns based on content (with a sane cap).
  ws.columns.forEach((col) => {
    if (!col) return
    let max = String(col.header || '').length
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value
      const len =
        v instanceof Date
          ? 18
          : v === null || v === undefined
          ? 0
          : String(v).length
      if (len > max) max = len
    })
    col.width = Math.min(Math.max(max + 2, 10), 60)
  })

  // Bold header row.
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).alignment = { vertical: 'middle' }

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    withExt(filename, 'xlsx'),
  )
}

/* ─────────────────────────────  Misc  ──────────────────────────────── */

function withExt(name: string, ext: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.' + ext)) return name
  return name + '.' + ext
}

/**
 * Best-effort plain-text extraction from a ReactNode. Used as a fallback when
 * a column has no explicit `exportValue` — handles strings, numbers, arrays,
 * fragments and React elements recursively. Components that render data via
 * imperative paint (icons, portals) just become empty strings, which is fine.
 */
export function reactNodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(reactNodeToText).join('')
  if (typeof node === 'object' && 'props' in (node as object)) {
    // The project's eslint config (extends `next/core-web-vitals`) does
    // not load `@typescript-eslint/eslint-plugin`, so referencing
    // `@typescript-eslint/no-explicit-any` in a disable directive used
    // to surface as an "unknown rule" error and broke `next lint`. We
    // keep the cast (React's `ReactNode` is intentionally opaque about
    // `.props.children`) but drop the inert disable comment.
    const children = (node as any).props?.children
    return reactNodeToText(children)
  }
  return ''
}

export function todayStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
