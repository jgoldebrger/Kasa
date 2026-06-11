import { NextRequest } from 'next/server'
import type { ImportType } from '@/lib/import-templates'
import { createImportTemplateBuffer } from '@/lib/import-templates'
import { IMPORT_CSV_FIXTURES } from '@/security/payloads/import-fixtures'
const ORIGIN = 'http://localhost:3000'

export type ImportProbeLabel =
  | 'families-csv'
  | 'members-csv'
  | 'payments-csv'
  | 'lifecycle-events-csv'
  | 'families-xlsx'
  | 'members-bound'

export function importProbeLabels(): ImportProbeLabel[] {
  return [
    'families-csv',
    'members-csv',
    'payments-csv',
    'lifecycle-events-csv',
    'families-xlsx',
    'members-bound',
  ]
}

function csvFixture(label: ImportProbeLabel): { type: ImportType; blob: Blob; filename: string } {
  switch (label) {
    case 'families-csv':
      return {
        type: 'families',
        blob: new Blob([IMPORT_CSV_FIXTURES.families.content], {
          type: IMPORT_CSV_FIXTURES.families.mime,
        }),
        filename: IMPORT_CSV_FIXTURES.families.filename,
      }
    case 'members-csv':
      return {
        type: 'members',
        blob: new Blob([IMPORT_CSV_FIXTURES.members.content], {
          type: IMPORT_CSV_FIXTURES.members.mime,
        }),
        filename: IMPORT_CSV_FIXTURES.members.filename,
      }
    case 'payments-csv':
      return {
        type: 'payments',
        blob: new Blob([IMPORT_CSV_FIXTURES.payments.content], {
          type: IMPORT_CSV_FIXTURES.payments.mime,
        }),
        filename: IMPORT_CSV_FIXTURES.payments.filename,
      }
    case 'lifecycle-events-csv':
      return {
        type: 'lifecycle-events',
        blob: new Blob([IMPORT_CSV_FIXTURES.lifecycleEvents.content], {
          type: IMPORT_CSV_FIXTURES.lifecycleEvents.mime,
        }),
        filename: IMPORT_CSV_FIXTURES.lifecycleEvents.filename,
      }
    default:
      return csvFixture('members-csv')
  }
}

export async function buildImportProbeRequest(
  label: ImportProbeLabel,
  opts?: { familyId?: string; memberId?: string },
): Promise<NextRequest> {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: ORIGIN,
  }

  const form = new FormData()

  if (label === 'families-xlsx') {
    const templateBuf = await createImportTemplateBuffer('families')
    const ExcelJS = await import('exceljs')
    const mod = ExcelJS.default ?? ExcelJS
    const wb = new mod.Workbook()
    await wb.xlsx.load(templateBuf)
    const ws = wb.worksheets[0]
    ws?.addRow(['Xlsx Import Family', '', '2019-03-01', '', '', '', '', '', '', 'xlsx@import.test'])
    const buf = await wb.xlsx.writeBuffer()
    form.set('type', 'families')
    form.set(
      'file',
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'families.xlsx',
    )
  } else if (label === 'members-bound') {
    const { type, blob, filename } = csvFixture('members-csv')
    form.set('type', type)
    form.set('file', blob, filename)
    if (opts?.familyId) form.set('familyId', opts.familyId)
    if (opts?.memberId) form.set('memberId', opts.memberId)
  } else {
    const { type, blob, filename } = csvFixture(label)
    form.set('type', type)
    form.set('file', blob, filename)
  }

  return new NextRequest(`${ORIGIN}/api/import`, { method: 'POST', headers, body: form })
}
