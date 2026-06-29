import {
  getImportColumns,
  type ImportColumn,
  type ImportType,
  type TemplateOptions,
} from '@/lib/import-templates'
import { normalizeColumnName } from '@/lib/import-utils'

/** Common spreadsheet header variants → template field keys. */
const HEADER_ALIASES: Record<string, string> = {
  familyname: 'name',
  family: 'name',
  weddingdate: 'weddingDate',
  marriagedate: 'weddingDate',
  firstname: 'firstName',
  lastname: 'lastName',
  familyemail: 'familyEmail',
  paymentdate: 'paymentDate',
  eventdate: 'eventDate',
  eventtype: 'eventType',
  paymentplan: 'paymentPlanNumber',
  paymentplannumber: 'paymentPlanNumber',
  plannumber: 'paymentPlanNumber',
}

/** Auto-suggest file-header → template-field mapping by normalized name. */
export function suggestColumnMapping(
  fileHeaders: string[],
  type: ImportType,
  opts: TemplateOptions = {},
): Record<string, string> {
  const templateCols = getImportColumns(type, opts)
  const byNorm = new Map<string, string>()
  for (const col of templateCols) {
    byNorm.set(normalizeColumnName(col.key), col.key)
  }

  const mapping: Record<string, string> = {}
  const validKeys = new Set(templateCols.map((c) => c.key))
  for (const header of fileHeaders) {
    const norm = normalizeColumnName(header)
    let match = byNorm.get(norm)
    if (!match && HEADER_ALIASES[norm] && validKeys.has(HEADER_ALIASES[norm])) {
      match = HEADER_ALIASES[norm]
    }
    if (match) mapping[header] = match
  }
  return mapping
}

/** Template columns with no mapped file header. */
export function getUnmappedRequiredColumns(
  fileHeaders: string[],
  columnMapping: Record<string, string>,
  type: ImportType,
  opts: TemplateOptions = {},
): ImportColumn[] {
  const mappedTargets = new Set(Object.values(columnMapping))
  return getImportColumns(type, opts).filter((col) => col.required && !mappedTargets.has(col.key))
}

/** Whether any required template column lacks a mapping. */
export function needsColumnMapping(
  fileHeaders: string[],
  type: ImportType,
  opts: TemplateOptions = {},
): boolean {
  const suggested = suggestColumnMapping(fileHeaders, type, opts)
  return getUnmappedRequiredColumns(fileHeaders, suggested, type, opts).length > 0
}

/**
 * Build the header index map the import parsers consume.
 * `columnMapping` maps file header labels to template field keys.
 */
export function buildHeaderMap(
  headers: string[],
  columnMapping?: Record<string, string>,
): Record<string, number> {
  const headerMap: Record<string, number> = {}

  headers.forEach((header, index) => {
    const mappedKey =
      columnMapping?.[header] ?? columnMapping?.[normalizeColumnName(header)] ?? header
    const norm = normalizeColumnName(mappedKey)
    if (norm) headerMap[norm] = index
  })

  return headerMap
}
