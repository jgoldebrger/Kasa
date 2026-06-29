'use client'

/**
 * ImportModal v2 — upload, column mapping, dry-run preview, then commit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { Modal } from './Modal'
import { Button } from './Button'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import { getImportColumns, IMPORT_LABELS, type ImportType } from '@/lib/import-templates'
import {
  getUnmappedRequiredColumns,
  needsColumnMapping,
  suggestColumnMapping,
} from '@/lib/import-column-mapping'
import type { ImportPreviewRow } from '@/lib/route-logic/import'

type WizardStep = 'upload' | 'mapping' | 'preview' | 'result'

interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  failed: number
  errors: string[]
  warnings: string[]
}

interface DryRunResult extends ImportResult {
  preview: ImportPreviewRow[]
}

interface PreviewRow {
  [column: string]: string
}

interface Props {
  open: boolean
  type: ImportType
  onClose: () => void
  onImported?: (result: { imported: number; failed: number }) => void
  familyId?: string
  memberId?: string
}

const PREVIEW_ROW_LIMIT = 5
const SKIP_COLUMN = ''

export default function ImportModal({
  open,
  type,
  onClose,
  onImported,
  familyId,
  memberId,
}: Props) {
  const t = useT()
  const toast = useToast()
  const templateOpts = useMemo(() => ({ boundToFamily: !!familyId }), [familyId])
  const templateColumns = useMemo(() => getImportColumns(type, templateOpts), [type, templateOpts])

  const [step, setStep] = useState<WizardStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)

  const resetState = useCallback(() => {
    setStep('upload')
    setFile(null)
    setPreview([])
    setHeaders([])
    setColumnMapping({})
    setDryRunResult(null)
    setResult(null)
    setBusy(false)
    setIsDragging(false)
    dragDepthRef.current = 0
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  useEffect(() => {
    if (!open) return
    resetState()
  }, [open, resetState])

  const unmappedRequired = useMemo(
    () => getUnmappedRequiredColumns(headers, columnMapping, type, templateOpts),
    [headers, columnMapping, type, templateOpts],
  )

  const mappingComplete = unmappedRequired.length === 0

  const acceptFile = async (selected: File) => {
    const lower = selected.name.toLowerCase()
    const isCsv = lower.endsWith('.csv')
    const isXlsx = lower.endsWith('.xlsx')
    if (!isCsv && !isXlsx) {
      toast.error(t('import.error.fileType'))
      return
    }

    setFile(selected)
    setDryRunResult(null)
    setResult(null)

    try {
      const parsed = isXlsx ? await readXlsxPreview(selected) : await readCsvPreview(selected)
      setHeaders(parsed.headers)
      setPreview(parsed.rows)
      const suggested = suggestColumnMapping(parsed.headers, type, templateOpts)
      setColumnMapping(suggested)
      setStep(needsColumnMapping(parsed.headers, type, templateOpts) ? 'mapping' : 'upload')
    } catch (err) {
      console.error('Error reading file:', err)
      toast.error(t('import.error.readFile'))
    }
  }

  const buildFormData = () => {
    const formData = new FormData()
    if (!file) throw new Error('No file')
    formData.append('file', file)
    formData.append('type', type)
    if (familyId) formData.append('familyId', familyId)
    if (memberId) formData.append('memberId', memberId)
    if (Object.keys(columnMapping).length > 0) {
      formData.append('columnMapping', JSON.stringify(columnMapping))
    }
    return formData
  }

  const runDryRun = async () => {
    if (!file) {
      toast.error(t('import.error.noFile'))
      return
    }
    if (!mappingComplete) {
      toast.error(t('import.error.mappingRequired'))
      setStep('mapping')
      return
    }

    setBusy(true)
    setDryRunResult(null)
    try {
      const res = await fetch('/api/import?dryRun=true', {
        method: 'POST',
        body: buildFormData(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('import.error.previewFailed'))
        return
      }
      const dry: DryRunResult = {
        success: true,
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        failed: data.failed || 0,
        errors: data.errors || [],
        warnings: data.warnings || [],
        preview: data.preview || [],
      }
      setDryRunResult(dry)
      setStep('preview')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('import.error.previewFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    if (!file) {
      toast.error(t('import.error.noFile'))
      return
    }
    if (!mappingComplete) {
      toast.error(t('import.error.mappingRequired'))
      setStep('mapping')
      return
    }

    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/import', { method: 'POST', body: buildFormData() })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        const imported = data.imported || 0
        const failed = data.failed || 0
        const skipped = data.skipped || 0
        setResult({
          success: true,
          imported,
          skipped,
          failed,
          errors: data.errors || [],
          warnings: data.warnings || [],
        })
        setStep('result')
        toast.success(
          t('import.success.imported')
            .replace('{count}', String(imported))
            .replace('{type}', IMPORT_LABELS[type].toLowerCase()),
        )
        onImported?.({ imported, failed })
      } else {
        setResult({
          success: false,
          imported: 0,
          skipped: 0,
          failed: 0,
          errors: [data.error || t('import.error.importFailed')],
          warnings: [],
        })
        setStep('result')
      }
    } catch (err: unknown) {
      setResult({
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [err instanceof Error ? err.message : t('import.error.importFailed')],
        warnings: [],
      })
      setStep('result')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) return
    onClose()
  }

  const setMappingForTemplate = (templateKey: string, fileHeader: string) => {
    setColumnMapping((prev) => {
      const next = { ...prev }
      for (const [header, target] of Object.entries(next)) {
        if (target === templateKey && header !== fileHeader) {
          delete next[header]
        }
      }
      if (fileHeader) {
        next[fileHeader] = templateKey
      }
      return next
    })
    setDryRunResult(null)
  }

  const footer = (() => {
    if (step === 'result') {
      return (
        <Button variant="ghost" onClick={handleClose}>
          {t('common.close')}
        </Button>
      )
    }

    return (
      <>
        <Button variant="ghost" onClick={handleClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        {step === 'upload' && (
          <>
            {headers.length > 0 && (
              <Button variant="secondary" onClick={() => setStep('mapping')} disabled={busy}>
                {t('import.mapColumns')}
              </Button>
            )}
            <Button
              onClick={() => void runDryRun()}
              disabled={!file || busy || !mappingComplete}
              loading={busy}
            >
              {t('import.previewImport')}
            </Button>
          </>
        )}
        {step === 'mapping' && (
          <>
            <Button variant="secondary" onClick={() => setStep('upload')} disabled={busy}>
              {t('common.back')}
            </Button>
            <Button
              onClick={() => void runDryRun()}
              disabled={!file || busy || !mappingComplete}
              loading={busy}
            >
              {t('import.previewImport')}
            </Button>
          </>
        )}
        {step === 'preview' && (
          <>
            <Button variant="secondary" onClick={() => setStep('mapping')} disabled={busy}>
              {t('import.editMapping')}
            </Button>
            <Button
              onClick={() => void handleImport()}
              disabled={!dryRunResult || dryRunResult.imported === 0 || busy}
              loading={busy}
            >
              {t('import.commitImport').replace('{count}', String(dryRunResult?.imported ?? 0))}
            </Button>
          </>
        )}
      </>
    )
  })()

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('import.title').replace('{type}', IMPORT_LABELS[type].toLowerCase())}
      description={
        familyId
          ? t('import.description.boundFamily').replace(
              '{member}',
              memberId ? t('import.description.andMember') : '',
            )
          : t('import.description.default')
      }
      maxWidth="max-w-3xl"
      dismissible={!busy}
      footer={footer}
    >
      <div className="space-y-4">
        {(step === 'upload' || step === 'mapping') && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const selected = e.target.files?.[0]
                if (selected) void acceptFile(selected)
              }}
              className="hidden"
              id="import-modal-file"
            />
            <label
              htmlFor="import-modal-file"
              onDragEnter={(e) => {
                if (busy) return
                e.preventDefault()
                e.stopPropagation()
                dragDepthRef.current += 1
                if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
              }}
              onDragOver={(e) => {
                if (busy) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'copy'
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
                if (dragDepthRef.current === 0) setIsDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragDepthRef.current = 0
                setIsDragging(false)
                if (busy) return
                const dropped = e.dataTransfer.files?.[0]
                if (!dropped) return
                if (e.dataTransfer.files.length > 1) {
                  toast.info(t('import.onlyFirstFile'))
                }
                void acceptFile(dropped)
              }}
              aria-disabled={busy || undefined}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                isDragging ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60'
              } ${busy ? 'pointer-events-none opacity-60' : ''}`}
            >
              <ArrowUpTrayIcon
                className={`h-10 w-10 ${isDragging ? 'text-accent' : 'text-fg-subtle'}`}
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium text-fg">
                  {isDragging ? t('import.dropHere') : file ? file.name : t('import.dropOrBrowse')}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {file && !isDragging ? t('import.changeFile') : t('import.fileTypes')}
                </p>
              </div>
            </label>
          </>
        )}

        {step === 'upload' && preview.length > 0 && (
          <FilePreviewTable headers={headers} rows={preview} t={t} />
        )}

        {step === 'mapping' && (
          <ColumnMappingPanel
            templateColumns={templateColumns}
            fileHeaders={headers}
            columnMapping={columnMapping}
            unmappedRequired={unmappedRequired}
            onChange={setMappingForTemplate}
            t={t}
          />
        )}

        {step === 'preview' && dryRunResult && <DryRunPreview result={dryRunResult} t={t} />}

        {step === 'result' && result && <ResultBlock result={result} t={t} />}
      </div>
    </Modal>
  )
}

function FilePreviewTable({
  headers,
  rows,
  t,
}: {
  headers: string[]
  rows: PreviewRow[]
  t: ReturnType<typeof useT>
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
        {t('import.filePreview').replace('{count}', String(rows.length))}
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
            {rows.map((row, i) => (
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
  )
}

function ColumnMappingPanel({
  templateColumns,
  fileHeaders,
  columnMapping,
  unmappedRequired,
  onChange,
  t,
}: {
  templateColumns: ReturnType<typeof getImportColumns>
  fileHeaders: string[]
  columnMapping: Record<string, string>
  unmappedRequired: ReturnType<typeof getUnmappedRequiredColumns>
  onChange: (templateKey: string, fileHeader: string) => void
  t: ReturnType<typeof useT>
}) {
  const reverseMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const [header, target] of Object.entries(columnMapping)) {
      m.set(target, header)
    }
    return m
  }, [columnMapping])

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-fg">{t('import.mapping.title')}</h3>
        <p className="mt-0.5 text-xs text-fg-muted">{t('import.mapping.description')}</p>
      </div>
      {unmappedRequired.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          {t('import.mapping.missingRequired').replace(
            '{fields}',
            unmappedRequired.map((c) => c.key).join(', '),
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-app-subtle text-left text-muted-on-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">{t('import.mapping.templateColumn')}</th>
              <th className="px-3 py-2 font-medium">{t('import.mapping.fileColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {templateColumns.map((col) => {
              const mappedHeader = reverseMap.get(col.key) || ''
              return (
                <tr key={col.key} className="border-t border-border">
                  <td className="px-3 py-2 text-fg">
                    <span className="font-medium">{col.key}</span>
                    {col.required && <span className="ml-1 text-red-500">*</span>}
                    {col.hint && <p className="mt-0.5 text-fg-muted">{col.hint}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-fg"
                      value={mappedHeader}
                      onChange={(e) => onChange(col.key, e.target.value)}
                    >
                      <option value={SKIP_COLUMN}>{t('import.mapping.skip')}</option>
                      {fileHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DryRunPreview({ result, t }: { result: DryRunResult; t: ReturnType<typeof useT> }) {
  const duplicateRows = result.preview.filter(
    (r) => r.similarFamilies && r.similarFamilies.length > 0,
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 dark:border-green-700 dark:bg-green-950/30">
          <p className="text-2xl font-semibold text-green-700 dark:text-green-300">
            {result.imported}
          </p>
          <p className="text-xs text-green-800 dark:text-green-200">{t('import.wouldImport')}</p>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30">
          <p className="text-2xl font-semibold text-amber-700 dark:text-amber-300">
            {result.skipped}
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200">{t('import.wouldSkip')}</p>
        </div>
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 dark:border-red-700 dark:bg-red-950/30">
          <p className="text-2xl font-semibold text-red-700 dark:text-red-300">{result.failed}</p>
          <p className="text-xs text-red-800 dark:text-red-200">{t('import.wouldFail')}</p>
        </div>
      </div>

      {duplicateRows.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 space-y-2 text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {t('import.duplicates.title')}
              </p>
              <ul className="space-y-2 text-xs text-amber-800 dark:text-amber-300">
                {duplicateRows.slice(0, 8).map((row) => (
                  <li key={row.rowNumber}>
                    <span className="font-medium">
                      {t('import.duplicates.row')
                        .replace('{row}', String(row.rowNumber))
                        .replace('{label}', row.label || '')}
                    </span>
                    <ul className="ml-4 mt-1 list-disc">
                      {row.similarFamilies!.map((match) => (
                        <li key={match.familyId}>
                          {t('import.duplicates.match')
                            .replace('{name}', match.name)
                            .replace('{score}', String(Math.round(match.score * 100)))
                            .replace('{reason}', match.matchReason)}
                          {match.email ? ` (${match.email})` : ''}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
          {t('import.previewRows')}
        </h3>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 border-b border-border bg-app-subtle text-left text-muted-on-subtle">
              <tr>
                <th className="px-3 py-1.5 font-medium">{t('import.col.row')}</th>
                <th className="px-3 py-1.5 font-medium">{t('import.col.action')}</th>
                <th className="px-3 py-1.5 font-medium">{t('import.col.label')}</th>
                <th className="px-3 py-1.5 font-medium">{t('import.col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {result.preview.slice(0, 50).map((row) => (
                <tr key={row.rowNumber} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-1.5 text-fg">{row.rowNumber}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <ActionBadge action={row.action} t={t} />
                  </td>
                  <td className="px-3 py-1.5 text-fg">{row.label || '—'}</td>
                  <td className="px-3 py-1.5 text-fg-muted">{row.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.preview.length > 50 && (
            <p className="border-t border-border px-3 py-2 text-xs text-fg-muted">
              {t('import.previewTruncated').replace('{count}', String(result.preview.length - 50))}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionBadge({
  action,
  t,
}: {
  action: ImportPreviewRow['action']
  t: ReturnType<typeof useT>
}) {
  const styles = {
    import: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    skip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  }
  const labels = {
    import: t('import.action.import'),
    skip: t('import.action.skip'),
    error: t('import.action.error'),
  }
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${styles[action]}`}
    >
      {labels[action]}
    </span>
  )
}

function ResultBlock({ result, t }: { result: ImportResult; t: ReturnType<typeof useT> }) {
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
            {result.success ? t('import.result.complete') : t('import.result.failed')}
          </p>
          {result.success && (
            <p className="text-fg">
              {t('import.result.summary')
                .replace('{imported}', String(result.imported))
                .replace('{skipped}', String(result.skipped))
                .replace('{failed}', String(result.failed))}
            </p>
          )}
          {result.warnings.length > 0 && (
            <div>
              <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">
                {t('import.result.warnings')}
              </p>
              <ul className="ml-4 list-disc text-xs text-amber-700 dark:text-amber-300">
                {result.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.warnings.length > 10 && (
                  <li>
                    {t('import.result.moreWarnings').replace(
                      '{count}',
                      String(result.warnings.length - 10),
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}
          {result.errors.length > 0 && (
            <div>
              <p className="mt-1 font-medium text-red-700 dark:text-red-300">
                {t('import.result.errors')}
              </p>
              <ul className="ml-4 list-disc text-xs text-red-700 dark:text-red-300">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {result.errors.length > 10 && (
                  <li>
                    {t('import.result.moreErrors').replace(
                      '{count}',
                      String(result.errors.length - 10),
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

async function readCsvPreview(file: File): Promise<{ headers: string[]; rows: PreviewRow[] }> {
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

async function readXlsxPreview(file: File): Promise<{ headers: string[]; rows: PreviewRow[] }> {
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
