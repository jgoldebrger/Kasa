/**
 * Import template definitions, shared by the in-table ImportMenu /
 * ImportModal and the `POST /api/import` endpoint. Templates are emitted as
 * formatted XLSX files with proper per-column cell types (dates as dates,
 * amounts as currency-formatted numbers) and right-to-left alignment on
 * Hebrew columns. CSV uploads remain supported on the server side.
 *
 *   - Dates use the `yyyy-mm-dd` Excel format and round-trip cleanly when
 *     the user edits in Excel.
 *   - `paymentMethod` is one of: cash | credit_card | check | quick_pay
 *     (enforced by the Payment schema enum in `lib/models.ts`).
 *   - `gender` is a free string but typically `male` / `female`.
 *   - `eventType` is lowercased on save and must match one of the org's
 *     configured event types (Settings → Event Types).
 *
 * Keep `IMPORT_COLUMNS` in sync with the parser in `app/api/import/route.ts`.
 */

export type ImportType = 'families' | 'members' | 'payments' | 'lifecycle-events'

export type ImportColumnType = 'text' | 'date' | 'number' | 'currency'

export interface ImportColumn {
  /** Header name. Must match what the API parser normalizes against. */
  key: string
  type?: ImportColumnType
  /** Render the column right-to-left in the generated XLSX. */
  rtl?: boolean
  required?: boolean
  width?: number
  /** Short note shown in the modal's Column format panel. */
  hint?: string
  /**
   * Column used to look up the target family by name or email (e.g. the
   * `familyName` / `familyEmail` pair on members / payments / events). These
   * columns are omitted when the import is bound to a specific family from
   * the family detail page — the server attaches every row to that family
   * server-side, so the columns would be redundant.
   */
  familyKey?: boolean
}

export interface TemplateOptions {
  /**
   * Drop columns marked `familyKey: true`. Used when generating templates
   * for an import that is pre-bound to a specific family on the server.
   */
  boundToFamily?: boolean
}

/** Returns the columns for a given import type, honoring TemplateOptions. */
export function getImportColumns(type: ImportType, opts: TemplateOptions = {}): ImportColumn[] {
  const cols = IMPORT_COLUMNS[type]
  return opts.boundToFamily ? cols.filter((c) => !c.familyKey) : cols
}

export const IMPORT_COLUMNS: Record<ImportType, ImportColumn[]> = {
  families: [
    { key: 'name', required: true, width: 22, hint: 'Required. Family display name.' },
    { key: 'hebrewName', rtl: true, width: 22, hint: 'Optional. Hebrew family name.' },
    { key: 'weddingDate', type: 'date', required: true, hint: 'Required. YYYY-MM-DD.' },
    { key: 'husbandFirstName', width: 18 },
    { key: 'husbandHebrewName', rtl: true, width: 18 },
    { key: 'husbandFatherHebrewName', rtl: true, width: 22 },
    { key: 'wifeFirstName', width: 18 },
    { key: 'wifeHebrewName', rtl: true, width: 18 },
    { key: 'wifeFatherHebrewName', rtl: true, width: 22 },
    { key: 'email', width: 26, hint: 'Optional. Used for matching on subsequent imports.' },
    { key: 'phone', width: 16 },
    { key: 'address', width: 24 },
    { key: 'city', width: 16 },
    { key: 'state', width: 8, hint: '2-letter code (NY, NJ, ...).' },
    { key: 'zip', width: 10 },
    { key: 'husbandCellPhone', width: 16 },
    { key: 'wifeCellPhone', width: 16 },
    { key: 'paymentPlanNumber', type: 'number', hint: 'Integer matching a configured plan.' },
  ],
  members: [
    { key: 'familyName', required: true, width: 22, familyKey: true, hint: 'Required (or familyEmail). Matches an existing family.' },
    { key: 'familyEmail', width: 26, familyKey: true, hint: 'Required (or familyName). Matches an existing family.' },
    { key: 'firstName', required: true },
    { key: 'lastName', required: true },
    { key: 'hebrewFirstName', rtl: true },
    { key: 'hebrewLastName', rtl: true },
    { key: 'birthDate', type: 'date' },
    { key: 'gender', hint: 'male | female.' },
    { key: 'barMitzvahDate', type: 'date' },
    { key: 'batMitzvahDate', type: 'date' },
    { key: 'weddingDate', type: 'date' },
  ],
  payments: [
    { key: 'familyName', required: true, width: 22, familyKey: true, hint: 'Required (or familyEmail). Matches an existing family.' },
    { key: 'familyEmail', width: 26, familyKey: true, hint: 'Required (or familyName). Matches an existing family.' },
    { key: 'amount', type: 'currency', required: true, hint: 'Required. Positive number, no currency symbol.' },
    { key: 'paymentDate', type: 'date', required: true, hint: 'Required. YYYY-MM-DD.' },
    { key: 'type', hint: 'membership | donation | other. Defaults to membership.' },
    { key: 'paymentMethod', hint: 'cash | credit_card | check | quick_pay. Defaults to cash.' },
    { key: 'notes', width: 30 },
  ],
  'lifecycle-events': [
    { key: 'familyName', required: true, width: 22, familyKey: true, hint: 'Required (or familyEmail). Matches an existing family.' },
    { key: 'familyEmail', width: 26, familyKey: true, hint: 'Required (or familyName). Matches an existing family.' },
    { key: 'eventType', required: true, hint: 'Required. Lowercase, must match a configured event type.' },
    { key: 'eventDate', type: 'date', required: true, hint: 'Required. YYYY-MM-DD.' },
    { key: 'amount', type: 'currency', hint: 'Optional. Number, defaults to 0.' },
    { key: 'notes', width: 30 },
  ],
}

export const IMPORT_LABELS: Record<ImportType, string> = {
  families: 'Families',
  members: 'Members',
  payments: 'Payments',
  'lifecycle-events': 'Lifecycle events',
}

/** Minimal worksheet surface used when building import templates. */
export interface ImportWorksheetLike {
  columns: { header?: string; key?: string; width?: number }[]
  getColumn(index: number): { numFmt?: string; alignment?: Record<string, unknown> }
  getRow(index: number): {
    font?: Record<string, unknown>
    alignment?: Record<string, unknown>
    height?: number
  }
}

/** Apply column defs, formats, and header styling to a worksheet. */
export function configureImportWorksheet(ws: ImportWorksheetLike, cols: ImportColumn[]): void {
  ws.columns = cols.map((c) => ({
    header: c.key,
    key: c.key,
    width: c.width ?? (c.type === 'date' ? 14 : c.type === 'currency' || c.type === 'number' ? 12 : 16),
  }))

  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.type === 'date') col.numFmt = 'yyyy-mm-dd'
    else if (c.type === 'currency') col.numFmt = '#,##0.00'
    else if (c.type === 'number') col.numFmt = '0'
    if (c.rtl) {
      col.alignment = { readingOrder: 'rtl', horizontal: 'right', vertical: 'middle' }
    }
  })

  const header = ws.getRow(1)
  header.font = { bold: true }
  header.alignment = { vertical: 'middle' }
  header.height = 22
}

type ExcelJsModule = {
  Workbook: new () => {
    creator: string
    created: Date
    xlsx: { writeBuffer: () => Promise<ArrayBuffer> }
    addWorksheet: (
      name: string,
      opts?: { views?: { state: string; ySplit: number }[] },
    ) => ImportWorksheetLike
  }
}

let excelJsLoader: (() => Promise<ExcelJsModule>) | undefined

/** Test hook: avoid dynamic `import()` so Vitest attributes coverage. */
export function setImportTemplateExcelLoader(loader: (() => Promise<ExcelJsModule>) | undefined): void {
  excelJsLoader = loader
}

async function loadExcelJs(): Promise<ExcelJsModule> {
  if (excelJsLoader) return excelJsLoader()
  const mod = await import('exceljs')
  return (mod.default || mod) as ExcelJsModule
}

/** Build an in-memory XLSX template buffer for the given import type. */
export async function createImportTemplateBuffer(
  type: ImportType,
  opts: TemplateOptions = {},
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kasa'
  wb.created = new Date()

  const ws = wb.addWorksheet(IMPORT_LABELS[type], {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  configureImportWorksheet(ws, getImportColumns(type, opts))
  return wb.xlsx.writeBuffer()
}

export function downloadXlsxBlob(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

/**
 * Generate a formatted XLSX template for the given import type and trigger
 * a browser download. Dates, currency and RTL alignment are baked into the
 * column styles so the file behaves correctly when opened in Excel.
 *
 * Pass `boundToFamily: true` to drop the `familyName` / `familyEmail` columns
 * (used when downloading a template from a family detail page, where every
 * imported row is attached to that family server-side).
 */
export async function downloadImportTemplate(
  type: ImportType,
  opts: TemplateOptions = {},
): Promise<void> {
  const buf = await createImportTemplateBuffer(type, opts)
  const filename = opts.boundToFamily
    ? `${type}-template-family.xlsx`
    : `${type}-template.xlsx`
  downloadXlsxBlob(buf, filename)
}
