'use client'

/**
 * ImportModal — file-upload + preview + POST to /api/import, rendered inside
 * a <Modal>. Spawned by <ImportMenu> from the DataView toolbar; calls
 * `onImported` so the parent can refresh its rows on success.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { Modal } from './Modal'
import { Button } from './Button'
import { useToast } from '@/app/components/Toast'
import { IMPORT_LABELS, type ImportType } from '@/lib/import-templates'

interface ImportResult {
  success: boolean
  imported: number
  failed: number
  errors: string[]
  warnings: string[]
}

interface PreviewRow {
  [column: string]: string
}

interface Props {
  open: boolean
  type: ImportType
  onClose: () => void
  /** Called after a successful import so the parent can refresh its rows. */
  onImported?: (result: { imported: number; failed: number }) => void
  /**
   * When set, every imported row is attached to this family server-side and
   * the familyName/familyEmail columns are dropped from the template. Used
   * by the Import action on the family detail page.
   */
  familyId?: string
  /**
   * Optional member binding (only meaningful with `familyId`). Member-scoped
   * payments / events get their memberId set automatically.
   */
  memberId?: string
}

export default function ImportModal({
  open,
  type,
  onClose,
  onImported,
  familyId,
  memberId,
}: Props) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Dragenter/leave fire on every child crossing in some browsers, so we use
  // a counter to only flip `isDragging` off when we actually leave the zone.
  const dragDepthRef = useRef(0)

  // Reset state every time the modal is reopened so a previous run's result
  // or selected file doesn't leak into the next session.
  useEffect(() => {
    if (!open) return
    setFile(null)
    setPreview([])
    setHeaders([])
    setResult(null)
    setImporting(false)
    setIsDragging(false)
    dragDepthRef.current = 0
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open])

  const acceptFile = async (selected: File) => {
    const lower = selected.name.toLowerCase()
    const isCsv = lower.endsWith('.csv')
    const isXlsx = lower.endsWith('.xlsx')
    if (!isCsv && !isXlsx) {
      toast.error('Please select a CSV or Excel (.xlsx) file')
      return
    }

    setFile(selected)
    setResult(null)

    try {
      const parsed = isXlsx ? await readXlsxPreview(selected) : await readCsvPreview(selected)
      setHeaders(parsed.headers)
      setPreview(parsed.rows)
    } catch (err) {
      console.error('Error reading file:', err)
      toast.error('Error reading file. Please try again.')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) void acceptFile(selected)
  }

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    if (importing) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    if (importing) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragging(false)
    if (importing) return

    const dropped = e.dataTransfer.files?.[0]
    if (!dropped) return
    if (e.dataTransfer.files.length > 1) {
      toast.info('Only the first file will be imported')
    }
    void acceptFile(dropped)
  }

  const handleImport = async () => {
    if (!file) {
      toast.error('Please select a CSV file first')
      return
    }

    setImporting(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)
      if (familyId) formData.append('familyId', familyId)
      if (memberId) formData.append('memberId', memberId)

      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        const imported = data.imported || 0
        const failed = data.failed || 0
        setResult({
          success: true,
          imported,
          failed,
          errors: data.errors || [],
          warnings: data.warnings || [],
        })
        toast.success(`Imported ${imported} ${IMPORT_LABELS[type].toLowerCase()}`)
        onImported?.({ imported, failed })
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setResult({
          success: false,
          imported: 0,
          failed: 0,
          errors: [data.error || 'Import failed'],
          warnings: [],
        })
      }
    } catch (err: any) {
      setResult({
        success: false,
        imported: 0,
        failed: 0,
        errors: [err?.message || 'Failed to import file'],
        warnings: [],
      })
    } finally {
      setImporting(false)
    }
  }

  const handleClose = () => {
    if (importing) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Import ${IMPORT_LABELS[type].toLowerCase()}`}
      description={
        familyId
          ? `Upload a CSV or Excel (.xlsx) file. Every row is added to this family${
              memberId ? ' and the current member' : ''
            } — no familyName / familyEmail columns needed.`
          : 'Upload a CSV or Excel (.xlsx) file. The first 5 rows are previewed before importing.'
      }
      maxWidth="max-w-3xl"
      dismissible={!importing}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={importing}>
            {result?.success ? 'Done' : 'Cancel'}
          </Button>
          <Button onClick={handleImport} disabled={!file || importing} loading={importing}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleFileSelect}
          className="hidden"
          id="import-modal-file"
        />
        <label
          htmlFor="import-modal-file"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-disabled={importing || undefined}
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            isDragging
              ? 'border-accent bg-accent/10'
              : 'border-border hover:border-accent/60'
          } ${importing ? 'pointer-events-none opacity-60' : ''}`}
        >
          <ArrowUpTrayIcon
            className={`h-10 w-10 ${isDragging ? 'text-accent' : 'text-fg-subtle'}`}
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-fg">
              {isDragging
                ? 'Drop your file here'
                : file
                ? file.name
                : 'Drop a CSV or Excel file here, or click to browse'}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {file && !isDragging ? 'Click or drop to change file' : 'CSV or Excel (.xlsx)'}
            </p>
          </div>
        </label>

        {preview.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
              Preview (first {preview.length} row{preview.length === 1 ? '' : 's'})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-app-subtle text-left text-muted-on-subtle">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-3 py-1.5 text-fg">
                          {row[h] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && <ResultBlock result={result} />}
      </div>
    </Modal>
  )
}

function ResultBlock({ result }: { result: ImportResult }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        result.success
          ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/30'
          : 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30'
      }`}
    >
      <div className="flex items-start gap-3">
        {result.success ? (
          <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <XCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
        )}
        <div className="flex-1 space-y-1.5 text-sm">
          <p
            className={`font-medium ${
              result.success
                ? 'text-green-800 dark:text-green-200'
                : 'text-red-800 dark:text-red-200'
            }`}
          >
            {result.success ? 'Import complete' : 'Import failed'}
          </p>
          {result.success && (
            <p className="text-fg">
              Imported <span className="font-medium">{result.imported}</span> record
              {result.imported === 1 ? '' : 's'}
              {result.failed > 0 && (
                <>
                  {' · '}
                  <span className="text-red-600 dark:text-red-400">
                    {result.failed} failed
                  </span>
                </>
              )}
            </p>
          )}
          {result.warnings.length > 0 && (
            <div>
              <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">Warnings</p>
              <ul className="ml-4 list-disc text-xs text-amber-700 dark:text-amber-300">
                {result.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.warnings.length > 10 && (
                  <li>…and {result.warnings.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
          {result.errors.length > 0 && (
            <div>
              <p className="mt-1 font-medium text-red-700 dark:text-red-300">Errors</p>
              <ul className="ml-4 list-disc text-xs text-red-700 dark:text-red-300">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {result.errors.length > 10 && (
                  <li>…and {result.errors.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const PREVIEW_ROW_LIMIT = 5

async function readCsvPreview(
  file: File,
): Promise<{ headers: string[]; rows: PreviewRow[] }> {
  const text = await file.text()
  const lines = text.split('\n').filter((line) => line.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
  const rows = lines.slice(1, 1 + PREVIEW_ROW_LIMIT).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/"/g, ''))
    const row: PreviewRow = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    return row
  })
  return { headers, rows }
}

async function readXlsxPreview(
  file: File,
): Promise<{ headers: string[]; rows: PreviewRow[] }> {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) return { headers: [], rows: [] }

  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(xlsxCellToString(cell.value).trim())
  })

  const rows: PreviewRow[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1 || rows.length >= PREVIEW_ROW_LIMIT) return
    const r: PreviewRow = {}
    for (let i = 0; i < headers.length; i++) {
      r[headers[i]] = xlsxCellToString(row.getCell(i + 1).value)
    }
    if (Object.values(r).some((v) => v.length > 0)) rows.push(r)
  })

  return { headers, rows }
}

// Mirrors the server-side coercion so the preview matches what the API will
// see after parsing the same file.
function xlsxCellToString(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if ('text' in obj) return String(obj.text ?? '')
    if ('result' in obj) return xlsxCellToString(obj.result)
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('')
    }
  }
  return String(v)
}
