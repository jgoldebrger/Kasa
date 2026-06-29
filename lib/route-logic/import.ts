import { Types } from 'mongoose'
import {
  Family,
  FamilyMember,
  Payment,
  LifecycleEventPayment,
  PaymentPlan,
  Organization,
  LifecycleEvent,
} from '@/lib/models'
import { audit } from '@/lib/audit'
import { roundMoney } from '@/lib/money'
import { getYearInTimeZone } from '@/lib/date-utils'
import { checkOrgBulkRateLimit, orgBulkRateLimit429 } from '@/lib/org-bulk-rate-limit'
import { sanitizeBatchErrors, sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { sanitizeUploadFilename, validateImportFile } from '@/lib/upload-validation'
import { handler } from '@/lib/api/handler'
import {
  assertCanAddFamily,
  countOrgFamilies,
  loadOrgBillingSnapshot,
} from '@/lib/billing/feature-gate'
import { scheduleYearlyCalculationRefreshForYears } from '@/lib/calculations'
import { buildHeaderMap } from '@/lib/import-column-mapping'
import { normalizeColumnName } from '@/lib/import-utils'
import {
  findSimilarFamilies,
  type ExistingFamilyRecord,
  type SimilarFamilyMatch,
} from '@/lib/family-duplicate-match'

export const dynamic = 'force-dynamic'

export type ImportRowAction = 'import' | 'skip' | 'error'

export interface ImportPreviewRow {
  rowNumber: number
  action: ImportRowAction
  label?: string
  reason?: string
  similarFamilies?: SimilarFamilyMatch[]
}

interface ImportRunOptions {
  dryRun: boolean
  preview: ImportPreviewRow[]
}

// Helper function to parse CSV
/**
 * RFC 4180-ish CSV parser.
 *
 * Walks `csvText` character-by-character so quoted fields can contain
 * commas AND embedded newlines, both of which broke the previous
 * line-then-comma split (it called `csvText.split('\n')` first, which
 * shredded any address / notes field that wrapped onto a second line).
 *
 * Quoting rules implemented:
 *   - A field opens with `"` -> we're inside quotes; commas and
 *     newlines are literal.
 *   - Inside quotes, `""` represents a single `"`.
 *   - Anything after the closing `"` until the next comma / newline
 *     is treated as part of the field (lenient).
 *
 * Row terminators recognized: `\n` and `\r\n`. Bare `\r` is treated
 * as a row terminator too (legacy Mac files).
 *
 * Returns the first non-empty row as headers; all subsequent
 * non-empty rows become data rows. Field values are trimmed of
 * surrounding whitespace OUTSIDE the quotes (interior whitespace is
 * preserved).
 */
export function parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
  // Strip a UTF-8 BOM if the file has one — common when CSVs are
  // exported from Excel on Windows.
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText

  const allRows: string[][] = []
  let currentRow: string[] = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    // Trim only when not strictly required-as-typed. Outer whitespace
    // around a comma-separated cell is almost always import noise.
    currentRow.push(field.trim())
    field = ''
  }
  const pushRow = () => {
    pushField()
    // Skip rows that are entirely empty (e.g. trailing blank line in the file).
    if (currentRow.some((v) => v.length > 0)) allRows.push(currentRow)
    currentRow = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        // RFC 4180 escape: `""` inside a quoted field is a literal `"`.
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      pushField()
      continue
    }
    if (ch === '\r') {
      // Eat `\r\n` together; bare `\r` also terminates a row.
      pushRow()
      if (text[i + 1] === '\n') i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      continue
    }
    field += ch
  }
  // Flush the final row (file may not end with a newline).
  if (field.length > 0 || currentRow.length > 0) pushRow()

  if (allRows.length === 0) return { headers: [], rows: [] }
  const headers = allRows[0]
  const rows = allRows.slice(1)
  return { headers, rows }
}

// Helper function to parse XLSX. Reads the first worksheet, takes row 1 as
// headers, and coerces every cell to a string so downstream importers work
// against the same `{ headers, rows }` shape as `parseCSV`.
async function parseXlsx(buf: ArrayBuffer): Promise<{ headers: string[]; rows: string[][] }> {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  /* v8 ignore start — Workbook()/load() lines are mis-attributed to the dynamic import above in merged v8 coverage */
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  /* v8 ignore stop */
  const ws = wb.worksheets[0]
  if (!ws) return { headers: [], rows: [] }

  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(xlsxCellToString(cell.value).trim())
  })

  const rows: string[][] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return
    const values: string[] = []
    for (let i = 1; i <= headers.length; i++) {
      values.push(xlsxCellToString(row.getCell(i).value))
    }
    if (values.some((v) => v.length > 0)) rows.push(values)
  })

  return { headers, rows }
}

// Coerce an exceljs cell value to the plain string the row-importers expect.
// Dates serialize to YYYY-MM-DD so `parseDate` round-trips cleanly; formula
// cells expose their evaluated result; rich-text concatenates its runs.
export function xlsxCellToString(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if ('text' in obj) return String(obj.text ?? '')
    if ('result' in obj) return xlsxCellToString(obj.result)
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('')
    }
    /* v8 ignore next -- unreachable: `text in obj` is handled above */
    if ('hyperlink' in obj && 'text' in obj) return String((obj as any).text ?? '')
  }
  return String(v)
}

// Helper to normalize column names — re-exported for callers that already import from here.
export { normalizeColumnName } from '@/lib/import-utils'

// Helper to parse date.
//
// Plain `new Date('2025-01-31')` interprets bare `YYYY-MM-DD` as **UTC
// midnight**, so users west of UTC saw every import shift back by one
// calendar day. We detect that exact shape and construct it as local
// midnight instead, which is what the spreadsheet user actually meant.
export function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === '') return null
  const trimmed = dateStr.trim()
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (isoDay) {
    const y = Number(isoDay[1])
    const m = Number(isoDay[2])
    const d = Number(isoDay[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const date = new Date(y, m - 1, d)
      return isNaN(date.getTime()) ? null : date
    }
  }
  const date = new Date(trimmed)
  if (isNaN(date.getTime())) return null
  const y = date.getFullYear()
  if (y < 1900 || y > 2200) return null
  return date
}

/** Parse a spreadsheet money cell — strips `$`, commas, and whitespace. */
export function parseMoneyAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '')
  if (!cleaned) return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const amount = Number(cleaned)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return roundMoney(amount)
}

// Escape regex metacharacters so user-supplied CSV names can't trigger ReDoS
// or unintended matches.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Helper to find family by name or email, scoped to a single org
async function findFamilyByNameOrEmail(organizationId: string, name?: string, email?: string) {
  if (!name && !email) return null

  const base = { organizationId }
  const trimmedName = name?.trim()
  const normalizedEmail = email?.trim().toLowerCase()

  // When both identifiers are supplied, prefer an exact pair match, then
  // fall back to name OR email — the old query required both (AND) and
  // rejected rows where only one column was filled in correctly.
  if (trimmedName && normalizedEmail) {
    const both = await Family.findOne({
      ...base,
      name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i'),
      email: normalizedEmail,
    })
    if (both) return both
  }
  if (trimmedName) {
    const byName = await Family.findOne({
      ...base,
      name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i'),
    })
    if (byName) return byName
  }
  if (normalizedEmail) {
    return Family.findOne({ ...base, email: normalizedEmail })
  }
  return null
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB (CSV or XLSX)
const MAX_UPLOAD_ROWS = 20_000

function uploadTooLargeResponse(maxBytes: number) {
  return {
    status: 413 as const,
    data: { error: `File exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit` },
  }
}

function requestContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'POST /api/import',
  fn: async ({ ctx, request }) => {
    const org = await Organization.findById(ctx!.organizationId).select('rateLimits').lean<{
      rateLimits?: { importPerHour?: number | null }
    }>()
    const rateVerdict = await checkOrgBulkRateLimit(
      request,
      ctx!.organizationId,
      'import',
      org?.rateLimits,
    )
    if (!rateVerdict.allowed) {
      return orgBulkRateLimit429(rateVerdict, 'Too many import requests. Try again later.')
    }

    const contentLength = requestContentLength(request)
    if (contentLength != null && contentLength > MAX_UPLOAD_BYTES) {
      return uploadTooLargeResponse(MAX_UPLOAD_BYTES)
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return uploadTooLargeResponse(MAX_UPLOAD_BYTES)
    }
    const file = formData.get('file') as File
    const importType = formData.get('type') as string
    // Optional family/member binding: when present, every imported row is
    // attached to this family (and optionally to this member), skipping the
    // familyName/familyEmail per-row lookup. Used by the Import action on
    // the family detail page.
    const boundFamilyId = (formData.get('familyId') as string | null)?.trim() || ''
    const boundMemberId = (formData.get('memberId') as string | null)?.trim() || ''

    if (!file) {
      return { status: 400, data: { error: 'File is required' } }
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return uploadTooLargeResponse(MAX_UPLOAD_BYTES)
    }

    const fileCheck = validateImportFile(file)
    if (!fileCheck.ok) {
      return { status: fileCheck.status, data: { error: fileCheck.error } }
    }

    if (!importType) {
      return { status: 400, data: { error: 'Import type is required' } }
    }

    const VALID_IMPORT_TYPES = ['families', 'members', 'payments', 'lifecycle-events'] as const
    if (!VALID_IMPORT_TYPES.includes(importType as (typeof VALID_IMPORT_TYPES)[number])) {
      return { status: 400, data: { error: 'Invalid import type' } }
    }

    // Branch on file extension / MIME.
    // anything else falls back to the CSV parser (so a `.csv` extension or no
    // extension at all still works).
    const filename = sanitizeUploadFilename(file.name || '').toLowerCase()
    const isXlsx =
      filename.endsWith('.xlsx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    let headers: string[]
    let rows: string[][]
    try {
      const parsed = isXlsx
        ? await parseXlsx(await file.arrayBuffer())
        : parseCSV(await file.text())
      headers = parsed.headers
      rows = parsed.rows
    } catch {
      return uploadTooLargeResponse(MAX_UPLOAD_BYTES)
    }

    if (rows.length > MAX_UPLOAD_ROWS) {
      return {
        status: 413,
        data: { error: `File exceeds ${MAX_UPLOAD_ROWS.toLocaleString()}-row limit` },
      }
    }

    if (headers.length === 0) {
      return { status: 400, data: { error: 'File is empty or invalid' } }
    }

    const dryRun = new URL(request.url).searchParams.get('dryRun') === 'true'

    let columnMapping: Record<string, string> | undefined
    const columnMappingRaw = (formData.get('columnMapping') as string | null)?.trim()
    if (columnMappingRaw) {
      try {
        const parsed = JSON.parse(columnMappingRaw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { status: 400, data: { error: 'Invalid columnMapping JSON' } }
        }
        columnMapping = parsed as Record<string, string>
      } catch {
        return { status: 400, data: { error: 'Invalid columnMapping JSON' } }
      }
    }

    const headerMap = buildHeaderMap(headers, columnMapping)

    // Validate the optional bound family / member once up front so we don't
    // hit the DB for every row. The bound family must belong to the caller's
    // org; the bound member must belong to that family.
    let boundMemberObjectId: string | undefined
    if (boundFamilyId) {
      if (!Types.ObjectId.isValid(boundFamilyId)) {
        return { status: 400, data: { error: 'Invalid bound familyId' } }
      }
      if (importType === 'families') {
        return {
          status: 400,
          data: { error: 'familyId binding is not supported for the families import type' },
        }
      }
      const fam = await Family.findOne({
        _id: boundFamilyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!fam) {
        return { status: 404, data: { error: 'Bound family not found or not accessible' } }
      }
      if (boundMemberId) {
        if (!Types.ObjectId.isValid(boundMemberId)) {
          return { status: 400, data: { error: 'Invalid bound memberId' } }
        }
        const mem = await FamilyMember.findOne({
          _id: boundMemberId,
          familyId: boundFamilyId,
          organizationId: ctx!.organizationId,
        }).select('_id')
        if (!mem) {
          return { status: 404, data: { error: 'Bound member not found in this family' } }
        }
        boundMemberObjectId = boundMemberId
      }
    } else if (boundMemberId) {
      return { status: 400, data: { error: 'memberId requires familyId' } }
    }

    const imported: number[] = []
    const skipped: number[] = []
    const errors: string[] = []
    const warnings: string[] = []
    const preview: ImportPreviewRow[] = []
    const runOpts: ImportRunOptions = { dryRun, preview }

    const orgDoc = await Organization.findById(ctx!.organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    const orgTimezone = orgDoc?.timezone

    switch (importType) {
      case 'families':
        await importFamilies(
          ctx!.organizationId,
          rows,
          headerMap,
          imported,
          skipped,
          errors,
          warnings,
          runOpts,
        )
        break
      case 'members':
        await importMembers(
          ctx!.organizationId,
          rows,
          headerMap,
          imported,
          skipped,
          errors,
          warnings,
          runOpts,
          boundFamilyId || undefined,
        )
        break
      case 'payments':
        await importPayments(
          ctx!.organizationId,
          rows,
          headerMap,
          imported,
          skipped,
          errors,
          warnings,
          runOpts,
          orgTimezone,
          boundFamilyId || undefined,
          boundMemberObjectId,
        )
        break
      case 'lifecycle-events':
        await importLifecycleEvents(
          ctx!.organizationId,
          rows,
          headerMap,
          imported,
          skipped,
          errors,
          warnings,
          runOpts,
          orgTimezone,
          boundFamilyId || undefined,
          boundMemberObjectId,
        )
        break
      default:
        /* v8 ignore next -- VALID_IMPORT_TYPES checked before switch */
        return { status: 400, data: { error: `Unknown import type: ${importType}` } }
    }

    if (!dryRun) {
      await audit({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        action: 'import.csv',
        resourceType: 'Import',
        metadata: {
          importType,
          importedCount: imported.length,
          skippedCount: skipped.length,
          failedCount: errors.length,
          warningCount: warnings.length,
          sampleErrors: errors.slice(0, 5),
          boundFamilyId: boundFamilyId || undefined,
          boundMemberId: boundMemberObjectId || undefined,
        },
        request,
      })
    }

    return {
      data: {
        success: true,
        dryRun,
        imported: imported.length,
        skipped: skipped.length,
        failed: errors.length,
        errors: sanitizeBatchErrors(errors),
        warnings,
        preview: dryRun ? preview : undefined,
      },
    }
  },
})

async function importFamilies(
  organizationId: string,
  rows: string[][],
  headerMap: { [key: string]: number },
  imported: number[],
  skipped: number[],
  errors: string[],
  warnings: string[],
  runOpts: ImportRunOptions,
) {
  const { dryRun, preview } = runOpts
  const getValue = (row: string[], field: string): string => {
    const index = headerMap[normalizeColumnName(field)]
    return index !== undefined ? (row[index] || '').trim() : ''
  }

  const pushPreview = (row: ImportPreviewRow) => {
    if (dryRun) preview.push(row)
  }

  // Get payment plans for lookup
  const paymentPlans = await loadAllByIdCursor<any>(
    (filter, limit) => PaymentPlan.find(filter).sort({ _id: 1 }).limit(limit).lean(),
    { organizationId },
  )
  const planMap: { [key: number]: string } = {}
  const validPlanIds = new Set<string>()
  paymentPlans.forEach((plan: any) => {
    validPlanIds.add(String(plan._id))
    if (plan.planNumber) {
      planMap[plan.planNumber] = plan._id.toString()
    }
  })

  const existingFamilies: ExistingFamilyRecord[] = (
    await Family.find({ organizationId })
      .select('name email')
      .lean<Array<{ _id: unknown; name?: string; email?: string }>>()
  ).map((f) => ({
    familyId: String(f._id),
    name: f.name || '',
    email: f.email || undefined,
  }))

  const billing = (await loadOrgBillingSnapshot(organizationId)) ?? {}
  let familyCount = await countOrgFamilies(organizationId)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2
    try {
      const name = getValue(row, 'name')
      if (!name) {
        errors.push(`Row ${rowNumber}: Family name is required`)
        pushPreview({ rowNumber, action: 'error', reason: 'Family name is required' })
        continue
      }

      const weddingDate = parseDate(getValue(row, 'weddingDate'))
      if (!weddingDate) {
        errors.push(`Row ${rowNumber}: Valid wedding date is required`)
        pushPreview({
          rowNumber,
          action: 'error',
          label: name,
          reason: 'Valid wedding date is required',
        })
        continue
      }

      let paymentPlanId = null
      const planIdStr = getValue(row, 'paymentPlanId')
      const planNumber = getValue(row, 'paymentPlanNumber') || getValue(row, 'planNumber')

      if (planIdStr) {
        if (!Types.ObjectId.isValid(planIdStr)) {
          warnings.push(`Row ${rowNumber}: Invalid paymentPlanId '${planIdStr}', ignoring`)
        } else if (!validPlanIds.has(planIdStr)) {
          warnings.push(
            `Row ${rowNumber}: Payment plan ${planIdStr} not found in this organization, ignoring`,
          )
        } else {
          paymentPlanId = planIdStr
        }
      } else if (planNumber) {
        const planNum = parseInt(planNumber, 10)
        if (!Number.isFinite(planNum)) {
          warnings.push(
            `Row ${rowNumber}: Invalid payment plan number '${planNumber}', using default`,
          )
        } else if (planMap[planNum]) {
          paymentPlanId = planMap[planNum]
        } else {
          warnings.push(`Row ${rowNumber}: Payment plan ${planNum} not found, using default`)
        }
      }

      const existing = await Family.findOne({
        name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
        organizationId,
      })
      if (existing) {
        const reason = `Family "${name}" already exists`
        warnings.push(`Row ${rowNumber}: ${reason}, skipping`)
        skipped.push(i)
        pushPreview({ rowNumber, action: 'skip', label: name, reason })
        continue
      }

      const email = getValue(row, 'email') || undefined
      const similarFamilies = findSimilarFamilies({ name, email }, existingFamilies, {
        excludeExactName: true,
      })
      if (similarFamilies.length > 0) {
        warnings.push(
          `Row ${rowNumber}: Similar famil${similarFamilies.length === 1 ? 'y' : 'ies'} found for "${name}"`,
        )
      }

      const familyGate = assertCanAddFamily(billing, familyCount)
      if (!familyGate.ok) {
        errors.push(`Row ${rowNumber}: ${familyGate.error}`)
        pushPreview({ rowNumber, action: 'error', label: name, reason: familyGate.error })
        continue
      }

      if (!dryRun) {
        await Family.create({
          organizationId,
          name,
          hebrewName: getValue(row, 'hebrewName') || undefined,
          weddingDate,
          husbandFirstName: getValue(row, 'husbandFirstName') || undefined,
          husbandHebrewName: getValue(row, 'husbandHebrewName') || undefined,
          husbandFatherHebrewName: getValue(row, 'husbandFatherHebrewName') || undefined,
          wifeFirstName: getValue(row, 'wifeFirstName') || undefined,
          wifeHebrewName: getValue(row, 'wifeHebrewName') || undefined,
          wifeFatherHebrewName: getValue(row, 'wifeFatherHebrewName') || undefined,
          email,
          phone: getValue(row, 'phone') || undefined,
          address: getValue(row, 'address') || getValue(row, 'street') || undefined,
          street: getValue(row, 'street') || getValue(row, 'address') || undefined,
          city: getValue(row, 'city') || undefined,
          state: getValue(row, 'state') || undefined,
          zip: getValue(row, 'zip') || undefined,
          husbandCellPhone: getValue(row, 'husbandCellPhone') || undefined,
          wifeCellPhone: getValue(row, 'wifeCellPhone') || undefined,
          paymentPlanId: paymentPlanId || undefined,
          currentPlan:
            planNumber && Number.isFinite(parseInt(planNumber, 10)) ? parseInt(planNumber, 10) : 1,
          openBalance: 0,
        })
      }

      familyCount += 1
      imported.push(i)
      pushPreview({
        rowNumber,
        action: 'import',
        label: name,
        similarFamilies: similarFamilies.length > 0 ? similarFamilies : undefined,
      })
    } catch (error: any) {
      const msg = sanitizeStripeErrorMessage(error.message) || 'Failed to import family'
      errors.push(`Row ${rowNumber}: ${msg}`)
      pushPreview({ rowNumber, action: 'error', reason: msg })
    }
  }
}

async function importMembers(
  organizationId: string,
  rows: string[][],
  headerMap: { [key: string]: number },
  imported: number[],
  skipped: number[],
  errors: string[],
  warnings: string[],
  runOpts: ImportRunOptions,
  boundFamilyId?: string,
) {
  const { dryRun, preview } = runOpts
  const getValue = (row: string[], field: string): string => {
    const index = headerMap[normalizeColumnName(field)]
    return index !== undefined ? (row[index] || '').trim() : ''
  }

  const pushPreview = (row: ImportPreviewRow) => {
    if (dryRun) preview.push(row)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2
    try {
      const firstName = getValue(row, 'firstName')
      const lastName = getValue(row, 'lastName')
      const label = [firstName, lastName].filter(Boolean).join(' ')
      if (!firstName || !lastName) {
        errors.push(`Row ${rowNumber}: First name and last name are required`)
        pushPreview({ rowNumber, action: 'error', reason: 'First name and last name are required' })
        continue
      }

      let familyId: string
      if (boundFamilyId) {
        familyId = boundFamilyId
      } else {
        const familyName = getValue(row, 'familyName')
        const familyEmail = getValue(row, 'familyEmail')
        let resolvedId = getValue(row, 'familyId')

        if (!resolvedId && (familyName || familyEmail)) {
          const family = await findFamilyByNameOrEmail(organizationId, familyName, familyEmail)
          if (family) {
            resolvedId = family._id.toString()
          } else {
            const reason = `Family not found (name: ${familyName}, email: ${familyEmail})`
            errors.push(`Row ${rowNumber}: ${reason}`)
            pushPreview({ rowNumber, action: 'error', label, reason })
            continue
          }
        } else if (resolvedId) {
          if (!Types.ObjectId.isValid(resolvedId)) {
            errors.push(`Row ${rowNumber}: Invalid familyId '${resolvedId}'`)
            pushPreview({
              rowNumber,
              action: 'error',
              label,
              reason: `Invalid familyId '${resolvedId}'`,
            })
            continue
          }
          const fam = await Family.findOne({ _id: resolvedId, organizationId }).select('_id')
          if (!fam) {
            errors.push(`Row ${rowNumber}: Family ID does not belong to this organization`)
            pushPreview({
              rowNumber,
              action: 'error',
              label,
              reason: 'Family ID does not belong to this organization',
            })
            continue
          }
        } else {
          errors.push(`Row ${rowNumber}: Family name or email is required`)
          pushPreview({
            rowNumber,
            action: 'error',
            label,
            reason: 'Family name or email is required',
          })
          continue
        }
        familyId = resolvedId
      }

      if (!dryRun) {
        await FamilyMember.create({
          organizationId,
          familyId,
          firstName,
          lastName,
          hebrewFirstName: getValue(row, 'hebrewFirstName') || undefined,
          hebrewLastName: getValue(row, 'hebrewLastName') || undefined,
          birthDate: parseDate(getValue(row, 'birthDate')) || undefined,
          gender: getValue(row, 'gender') || undefined,
          barMitzvahDate: parseDate(getValue(row, 'barMitzvahDate')) || undefined,
          batMitzvahDate: parseDate(getValue(row, 'batMitzvahDate')) || undefined,
          weddingDate: parseDate(getValue(row, 'weddingDate')) || undefined,
        })
      }

      imported.push(i)
      pushPreview({ rowNumber, action: 'import', label })
    } catch (error: any) {
      const msg = sanitizeStripeErrorMessage(error.message) || 'Failed to import member'
      errors.push(`Row ${rowNumber}: ${msg}`)
      pushPreview({ rowNumber, action: 'error', reason: msg })
    }
  }
}

async function importPayments(
  organizationId: string,
  rows: string[][],
  headerMap: { [key: string]: number },
  imported: number[],
  skipped: number[],
  errors: string[],
  warnings: string[],
  runOpts: ImportRunOptions,
  orgTimezone?: string,
  boundFamilyId?: string,
  boundMemberId?: string,
) {
  const { dryRun, preview } = runOpts
  const yearsToRefresh = new Set<number>()
  const getValue = (row: string[], field: string): string => {
    const index = headerMap[normalizeColumnName(field)]
    return index !== undefined ? (row[index] || '').trim() : ''
  }

  const pushPreview = (row: ImportPreviewRow) => {
    if (dryRun) preview.push(row)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2
    try {
      const amountStr = getValue(row, 'amount')
      const amount = parseMoneyAmount(amountStr)
      if (amount === null) {
        errors.push(`Row ${rowNumber}: Valid amount is required`)
        pushPreview({ rowNumber, action: 'error', reason: 'Valid amount is required' })
        continue
      }

      const paymentDate = parseDate(getValue(row, 'paymentDate'))
      if (!paymentDate) {
        errors.push(`Row ${rowNumber}: Valid payment date is required`)
        pushPreview({ rowNumber, action: 'error', reason: 'Valid payment date is required' })
        continue
      }

      let familyId: string
      let label = amountStr
      if (boundFamilyId) {
        familyId = boundFamilyId
      } else {
        const familyName = getValue(row, 'familyName')
        const familyEmail = getValue(row, 'familyEmail')
        let resolvedId = getValue(row, 'familyId')

        if (!resolvedId && (familyName || familyEmail)) {
          const family = await findFamilyByNameOrEmail(organizationId, familyName, familyEmail)
          if (family) {
            resolvedId = family._id.toString()
            label = familyName || amountStr
          } else {
            const reason = `Family not found (name: ${familyName}, email: ${familyEmail})`
            errors.push(`Row ${rowNumber}: ${reason}`)
            pushPreview({ rowNumber, action: 'error', label: amountStr, reason })
            continue
          }
        } else if (resolvedId) {
          if (!Types.ObjectId.isValid(resolvedId)) {
            errors.push(`Row ${rowNumber}: Invalid familyId '${resolvedId}'`)
            pushPreview({
              rowNumber,
              action: 'error',
              label: amountStr,
              reason: `Invalid familyId '${resolvedId}'`,
            })
            continue
          }
          const fam = await Family.findOne({ _id: resolvedId, organizationId }).select('_id name')
          if (!fam) {
            errors.push(`Row ${rowNumber}: Family ID does not belong to this organization`)
            pushPreview({
              rowNumber,
              action: 'error',
              label: amountStr,
              reason: 'Family ID does not belong to this organization',
            })
            continue
          }
          label = (fam as { name?: string }).name || amountStr
        } else {
          errors.push(`Row ${rowNumber}: Family name or email is required`)
          pushPreview({
            rowNumber,
            action: 'error',
            label: amountStr,
            reason: 'Family name or email is required',
          })
          continue
        }
        familyId = resolvedId
      }

      const yearRaw = getValue(row, 'year')
      let year: number
      if (yearRaw) {
        year = parseInt(yearRaw, 10)
        if (!Number.isFinite(year) || year < 1900 || year > 2200) {
          errors.push(`Row ${rowNumber}: Invalid year '${yearRaw}'`)
          pushPreview({ rowNumber, action: 'error', label, reason: `Invalid year '${yearRaw}'` })
          continue
        }
      } else {
        year = getYearInTimeZone(orgTimezone, paymentDate)
      }

      let memberId: string | undefined = boundMemberId
      const rowMemberId = getValue(row, 'memberId')
      if (rowMemberId) {
        if (!Types.ObjectId.isValid(rowMemberId)) {
          errors.push(`Row ${rowNumber}: Invalid memberId '${rowMemberId}'`)
          pushPreview({
            rowNumber,
            action: 'error',
            label,
            reason: `Invalid memberId '${rowMemberId}'`,
          })
          continue
        }
        const mem = await FamilyMember.findOne({
          _id: rowMemberId,
          familyId,
          organizationId,
        }).select('_id')
        if (!mem) {
          errors.push(`Row ${rowNumber}: Member not found in family`)
          pushPreview({ rowNumber, action: 'error', label, reason: 'Member not found in family' })
          continue
        }
        memberId = rowMemberId
      }

      const refundedRaw = getValue(row, 'refundedAmount')
      let refundedAmount = 0
      if (refundedRaw) {
        const cleaned = refundedRaw.trim().replace(/[$,\s]/g, '')
        const parsed = Number(cleaned)
        if (!Number.isFinite(parsed) || parsed < 0) {
          errors.push(`Row ${rowNumber}: Invalid refundedAmount '${refundedRaw}'`)
          pushPreview({
            rowNumber,
            action: 'error',
            label,
            reason: `Invalid refundedAmount '${refundedRaw}'`,
          })
          continue
        }
        refundedAmount = roundMoney(parsed)
        if (refundedAmount > amount) {
          const reason = `refundedAmount (${refundedRaw}) cannot exceed amount (${amountStr})`
          errors.push(`Row ${rowNumber}: ${reason}`)
          pushPreview({ rowNumber, action: 'error', label, reason })
          continue
        }
      }

      if (!dryRun) {
        await Payment.create({
          organizationId,
          familyId,
          memberId: memberId || undefined,
          amount,
          paymentDate,
          year,
          type: getValue(row, 'type') || 'membership',
          paymentMethod: getValue(row, 'paymentMethod') || 'cash',
          notes: getValue(row, 'notes') || undefined,
          ...(refundedAmount > 0 ? { refundedAmount } : {}),
        })
      }

      yearsToRefresh.add(year)
      imported.push(i)
      pushPreview({ rowNumber, action: 'import', label })
    } catch (error: any) {
      const msg = sanitizeStripeErrorMessage(error.message) || 'Failed to import payment'
      errors.push(`Row ${rowNumber}: ${msg}`)
      pushPreview({ rowNumber, action: 'error', reason: msg })
    }
  }

  if (!dryRun && yearsToRefresh.size > 0) {
    scheduleYearlyCalculationRefreshForYears(yearsToRefresh, organizationId)
  }
}

async function importLifecycleEvents(
  organizationId: string,
  rows: string[][],
  headerMap: { [key: string]: number },
  imported: number[],
  skipped: number[],
  errors: string[],
  warnings: string[],
  runOpts: ImportRunOptions,
  orgTimezone?: string,
  boundFamilyId?: string,
  boundMemberId?: string,
) {
  const { dryRun, preview } = runOpts
  const getValue = (row: string[], field: string): string => {
    const index = headerMap[normalizeColumnName(field)]
    return index !== undefined ? (row[index] || '').trim() : ''
  }

  const pushPreview = (row: ImportPreviewRow) => {
    if (dryRun) preview.push(row)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2
    try {
      const eventType = getValue(row, 'eventType')
      if (!eventType) {
        errors.push(`Row ${rowNumber}: Event type is required`)
        pushPreview({ rowNumber, action: 'error', reason: 'Event type is required' })
        continue
      }

      const eventDate = parseDate(getValue(row, 'eventDate'))
      if (!eventDate) {
        errors.push(`Row ${rowNumber}: Valid event date is required`)
        pushPreview({ rowNumber, action: 'error', reason: 'Valid event date is required' })
        continue
      }

      const amountStr = getValue(row, 'amount')
      const normalizedEventType = eventType.toLowerCase()
      let amount: number
      if (amountStr) {
        const parsed = parseMoneyAmount(amountStr)
        if (parsed === null) {
          errors.push(`Row ${rowNumber}: Invalid amount '${amountStr}'`)
          pushPreview({ rowNumber, action: 'error', reason: `Invalid amount '${amountStr}'` })
          continue
        }
        amount = parsed
      } else {
        const eventTypeRecord = await LifecycleEvent.findOne({
          type: normalizedEventType,
          organizationId,
        }).select('amount')
        if (!eventTypeRecord) {
          const reason = `Event type '${eventType}' not found in this organization; provide an amount`
          errors.push(`Row ${rowNumber}: ${reason}`)
          pushPreview({ rowNumber, action: 'error', reason })
          continue
        }
        amount = Number(eventTypeRecord.amount || 0)
      }
      if (!Number.isFinite(amount) || amount < 0) {
        errors.push(`Row ${rowNumber}: Invalid event amount`)
        pushPreview({ rowNumber, action: 'error', reason: 'Invalid event amount' })
        continue
      }

      let familyId: string
      let label = eventType
      if (boundFamilyId) {
        familyId = boundFamilyId
      } else {
        const familyName = getValue(row, 'familyName')
        const familyEmail = getValue(row, 'familyEmail')
        let resolvedId = getValue(row, 'familyId')

        if (!resolvedId && (familyName || familyEmail)) {
          const family = await findFamilyByNameOrEmail(organizationId, familyName, familyEmail)
          if (family) {
            resolvedId = family._id.toString()
            label = familyName || eventType
          } else {
            const reason = `Family not found (name: ${familyName}, email: ${familyEmail})`
            errors.push(`Row ${rowNumber}: ${reason}`)
            pushPreview({ rowNumber, action: 'error', label: eventType, reason })
            continue
          }
        } else if (resolvedId) {
          if (!Types.ObjectId.isValid(resolvedId)) {
            errors.push(`Row ${rowNumber}: Invalid familyId '${resolvedId}'`)
            pushPreview({
              rowNumber,
              action: 'error',
              label: eventType,
              reason: `Invalid familyId '${resolvedId}'`,
            })
            continue
          }
          const fam = await Family.findOne({ _id: resolvedId, organizationId }).select('_id name')
          if (!fam) {
            errors.push(`Row ${rowNumber}: Family ID does not belong to this organization`)
            pushPreview({
              rowNumber,
              action: 'error',
              label: eventType,
              reason: 'Family ID does not belong to this organization',
            })
            continue
          }
          label = (fam as { name?: string }).name || eventType
        } else {
          errors.push(`Row ${rowNumber}: Family name or email is required`)
          pushPreview({
            rowNumber,
            action: 'error',
            label: eventType,
            reason: 'Family name or email is required',
          })
          continue
        }
        familyId = resolvedId
      }

      const yearRaw = getValue(row, 'year')
      let year: number
      if (yearRaw) {
        year = parseInt(yearRaw, 10)
        if (!Number.isFinite(year) || year < 1900 || year > 2200) {
          errors.push(`Row ${rowNumber}: Invalid year '${yearRaw}'`)
          pushPreview({ rowNumber, action: 'error', label, reason: `Invalid year '${yearRaw}'` })
          continue
        }
      } else {
        year = getYearInTimeZone(orgTimezone, eventDate)
      }

      let memberId: string | undefined = boundMemberId
      const rowMemberId = getValue(row, 'memberId')
      if (rowMemberId) {
        if (!Types.ObjectId.isValid(rowMemberId)) {
          errors.push(`Row ${rowNumber}: Invalid memberId '${rowMemberId}'`)
          pushPreview({
            rowNumber,
            action: 'error',
            label,
            reason: `Invalid memberId '${rowMemberId}'`,
          })
          continue
        }
        const mem = await FamilyMember.findOne({
          _id: rowMemberId,
          familyId,
          organizationId,
        }).select('_id')
        if (!mem) {
          errors.push(`Row ${rowNumber}: Member not found in family`)
          pushPreview({ rowNumber, action: 'error', label, reason: 'Member not found in family' })
          continue
        }
        memberId = rowMemberId
      }

      if (!dryRun) {
        await LifecycleEventPayment.create({
          organizationId,
          familyId,
          memberId: memberId || undefined,
          eventType: normalizedEventType,
          eventDate,
          year,
          amount,
          notes: getValue(row, 'notes') || undefined,
        })
      }

      imported.push(i)
      pushPreview({ rowNumber, action: 'import', label })
    } catch (error: any) {
      const msg = sanitizeStripeErrorMessage(error.message) || 'Failed to import lifecycle event'
      errors.push(`Row ${rowNumber}: ${msg}`)
      pushPreview({ rowNumber, action: 'error', reason: msg })
    }
  }
}
