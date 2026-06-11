import { describe, expect, it, afterEach } from 'vitest'
import {
  configureImportWorksheet,
  createImportTemplateBuffer,
  getImportColumns,
  IMPORT_COLUMNS,
  setImportTemplateExcelLoader,
} from './import-templates'

function mockExcelJs() {
  class Workbook {
    creator = ''
    created = new Date()
    xlsx = { writeBuffer: async () => new Uint8Array([0x50, 0x4b]).buffer }
    addWorksheet() {
      return {
        columns: [] as { header?: string; key?: string; width?: number }[],
        getColumn: () => ({}),
        getRow: () => ({ font: {}, alignment: {}, height: 0 }),
      }
    }
  }
  return { Workbook }
}

afterEach(() => {
  setImportTemplateExcelLoader(undefined)
})

describe('import-templates', () => {
  it('returns all columns by default', () => {
    const cols = getImportColumns('members')
    expect(cols.length).toBe(IMPORT_COLUMNS.members.length)
    expect(cols.some((c) => c.familyKey)).toBe(true)
  })

  it('drops familyKey columns when boundToFamily', () => {
    const cols = getImportColumns('payments', { boundToFamily: true })
    expect(cols.every((c) => !c.familyKey)).toBe(true)
    expect(cols.length).toBeLessThan(IMPORT_COLUMNS.payments.length)
  })

  it('createImportTemplateBuffer returns an XLSX buffer', async () => {
    setImportTemplateExcelLoader(async () => mockExcelJs())
    const buf = await createImportTemplateBuffer('payments', { boundToFamily: true })
    expect(buf).toBeInstanceOf(ArrayBuffer)
    expect(buf.byteLength).toBeGreaterThan(0)
  })

  it('configureImportWorksheet applies formats for all column types', () => {
    const cols = [
      { key: 'plain', width: 10 },
      { key: 'when', type: 'date' as const },
      { key: 'amount', type: 'currency' as const },
      { key: 'count', type: 'number' as const },
      { key: 'hebrew', rtl: true },
    ]
    const columns: { numFmt?: string; alignment?: Record<string, unknown> }[] = [
      {},
      {},
      {},
      {},
      {},
    ]
    const ws = {
      columns: [] as { header?: string; key?: string; width?: number }[],
      getColumn: (i: number) => columns[i - 1]!,
      getRow: () => ({ font: {}, alignment: {}, height: 0 }),
    }

    configureImportWorksheet(ws, cols)

    expect(ws.columns[0]?.width).toBe(10)
    expect(ws.columns[1]?.width).toBe(14)
    expect(ws.columns[2]?.width).toBe(12)
    expect(columns[1]?.numFmt).toBe('yyyy-mm-dd')
    expect(columns[2]?.numFmt).toBe('#,##0.00')
    expect(columns[3]?.numFmt).toBe('0')
    expect(columns[4]?.alignment?.readingOrder).toBe('rtl')
  })

  it('defines required family and payment columns', () => {
    const families = getImportColumns('families')
    expect(families.find((c) => c.key === 'name')?.required).toBe(true)
    expect(families.find((c) => c.key === 'weddingDate')?.type).toBe('date')

    const payments = getImportColumns('payments')
    expect(payments.find((c) => c.key === 'amount')?.type).toBe('currency')
  })
})
