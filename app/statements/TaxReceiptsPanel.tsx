'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownTrayIcon,
  DocumentArrowDownIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import {
  Button,
  DataView,
  EmptyState,
  Select,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useToast, useConfirm } from '@/app/components/Toast'

/**
 * Year-end Tax Receipts panel.
 *
 * Mounts under the "Tax Receipts" tab on the Statements page. Lets an
 * admin:
 *   1. Pick a year (defaults to last completed calendar year).
 *   2. Preview a table of every family with dues paid that year + the
 *      total contributed.
 *   3. Take one of three actions:
 *      - Download a single PDF for one family
 *      - Download a zip of every eligible family's PDF
 *      - Email the receipt to every eligible family (background job)
 */

interface ReceiptRow {
  familyId: string
  familyName: string
  totalPaid: number
  email: string
  emailOptOut: boolean
  payments: { date: string; method: string; amount: number; notes: string }[]
  address: { street: string; city: string; state: string; zip: string }
}

function currentDefaultYear() {
  return new Date().getFullYear() - 1
}

export default function TaxReceiptsPanel() {
  const toast = useToast()
  const confirm = useConfirm()
  const { format: formatMoney } = useCurrency()
  const [year, setYear] = useState<number>(currentDefaultYear())
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkEmailing, setBulkEmailing] = useState(false)
  const [emailJobStatus, setEmailJobStatus] = useState<{
    jobId: string
    processed: number
    total: number
    sent: number
    failed: number
    done: boolean
  } | null>(null)
  const mountedRef = useRef(true)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollGenRef = useRef(0)
  const { begin, invalidate, isStale } = useRequestGeneration()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  const yearOptions = useMemo(() => {
    const max = new Date().getFullYear()
    const arr: number[] = []
    for (let y = max; y >= max - 8; y--) arr.push(y)
    return arr
  }, [])

  const fetchRows = useCallback(
    async (y: number) => {
      const gen = begin()
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/tax-receipts?year=${y}`)
        if (isStale(gen)) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body?.error || 'Failed to load receipts')
          setRows([])
          return
        }
        const data = await res.json().catch(() => [])
        if (isStale(gen)) return
        setRows(Array.isArray(data) ? data : [])
      } catch (e: any) {
        if (isStale(gen)) return
        console.error('Error loading tax receipts:', e)
        setError(e?.message || 'Failed to load receipts')
        setRows([])
      } finally {
        if (!isStale(gen)) setLoading(false)
      }
    },
    [begin, isStale],
  )

  useEffect(() => {
    const gen = begin()
    void fetchRows(year)
    return () => {
      invalidate()
    }
  }, [year, fetchRows, begin, invalidate])

  useOrgChanged(useCallback(() => {
    invalidate()
    pollGenRef.current += 1
    setRows([])
    setEmailJobStatus(null)
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    void fetchRows(year)
  }, [year, fetchRows, invalidate]))

  const downloadOne = useCallback(
    async (row: ReceiptRow) => {
      setDownloadingId(row.familyId)
      try {
        const res = await fetch(`/api/tax-receipts/${row.familyId}/pdf?year=${year}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body?.error || 'Failed to download receipt')
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Tax_Receipt_${row.familyName.replace(/[^a-z0-9_\-]+/gi, '_')}_${year}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } finally {
        setDownloadingId(null)
      }
    },
    [year, toast],
  )

  const downloadAll = async () => {
    if (rows.length === 0) return
    setBulkDownloading(true)
    try {
      const res = await fetch(`/api/tax-receipts/zip?year=${year}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Failed to build bulk ZIP.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Tax_Receipts_${year}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${rows.length} receipts`)
    } catch (e) {
      console.error('bulk download failed', e)
      toast.error('Failed to download bulk ZIP.')
    } finally {
      setBulkDownloading(false)
    }
  }

  const emailAll = async () => {
    if (rows.length === 0) return
    const eligible = rows.filter((r) => !r.emailOptOut && r.email)
    if (eligible.length === 0) {
      toast.error('No families with an email on file (excluding opt-outs).')
      return
    }
    const ok = await confirm({
      title: `Email ${eligible.length} receipts?`,
      message: `Each eligible family will receive their ${year} annual donation receipt as a PDF attachment.`,
    })
    if (!ok) return

    setBulkEmailing(true)
    setEmailJobStatus(null)
    try {
      const res = await fetch('/api/tax-receipts/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error || 'Failed to start email job')
        return
      }
      if (!body.jobId) {
        // Happens when 0 families ended up eligible after the API's own
        // filtering (e.g. paid-this-year + has-email + not-opted-out).
        toast.error(body?.message || 'No eligible families to email')
        return
      }
      toast.success(`Started — emailing ${body.totalFamilies} families.`)
      pollJob(body.jobId, body.totalFamilies)
    } finally {
      setBulkEmailing(false)
    }
  }

  const pollJob = useCallback((jobId: string, total: number) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    const pollGen = ++pollGenRef.current
    const tick = async () => {
      if (!mountedRef.current || pollGen !== pollGenRef.current) return
      try {
        const res = await fetch(`/api/statements/send-emails/status?jobId=${jobId}`)
        if (!mountedRef.current || pollGen !== pollGenRef.current) return
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (!mountedRef.current || pollGen !== pollGenRef.current) return
        setEmailJobStatus({
          jobId,
          processed: Number(data.processed || 0),
          total: Number(data.totalFamilies || total || 0),
          sent: Number(data.sent || 0),
          failed: Number(data.failed || 0),
          done: !!data.done,
        })
        if (!data.done) {
          if (pollGen === pollGenRef.current) {
            pollTimerRef.current = setTimeout(tick, 2000)
          }
          return
        }
        if (data.failed > 0) {
          toast.error(`Job complete — ${data.sent} sent, ${data.failed} failed.`)
        } else {
          toast.success(`Sent ${data.sent} receipts.`)
        }
      } catch (e) {
        console.error('status poll failed', e)
      }
    }
    void tick()
  }, [toast])

  const columns: DataColumn<ReceiptRow>[] = useMemo(
    () => [
      {
        id: 'familyName',
        header: 'Family',
        headerText: 'Family',
        cell: (r) => <span className="font-medium text-fg">{r.familyName}</span>,
        exportValue: (r) => r.familyName,
        filter: { type: 'text' },
      },
      {
        id: 'email',
        header: 'Email',
        headerText: 'Email',
        cell: (r) => (
          <span className={r.emailOptOut || !r.email ? 'text-fg-muted italic' : 'text-fg'}>
            {r.email || '(no email)'}{r.emailOptOut ? ' — opted out' : ''}
          </span>
        ),
        exportValue: (r) => r.email || '',
      },
      {
        id: 'count',
        header: 'Payments',
        headerText: 'Payments',
        cell: (r) => <span className="tabular text-fg">{r.payments.length}</span>,
        exportValue: (r) => r.payments.length,
      },
      {
        id: 'totalPaid',
        header: 'Total',
        headerText: 'Total',
        cell: (r) => (
          <span className="tabular font-semibold text-green-700 dark:text-green-400">
            {formatMoney(r.totalPaid)}
          </span>
        ),
        exportValue: (r) => r.totalPaid,
      },
      {
        id: 'actions',
        header: '',
        headerText: 'Actions',
        cell: (r) => (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
            loading={downloadingId === r.familyId}
            onClick={() => downloadOne(r)}
          >
            PDF
          </Button>
        ),
        // Skip export — action column.
        exportValue: () => '',
      },
    ],
    [downloadingId, formatMoney, downloadOne],
  )

  return (
    <div className="bg-surface rounded-2xl shadow border border-border">
      <div className="p-4 sm:p-6 border-b border-border flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">Year-end Tax Receipts</h2>
          <p className="text-sm text-fg-muted">
            Membership dues only. Lifecycle event payments are not included.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <Select
            label="Tax year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            wrapperClassName="w-28"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            leftIcon={<DocumentArrowDownIcon className="h-4 w-4" />}
            loading={bulkDownloading}
            disabled={rows.length === 0 || loading}
            onClick={downloadAll}
          >
            Download all PDFs
          </Button>
          <Button
            leftIcon={<EnvelopeIcon className="h-4 w-4" />}
            loading={bulkEmailing}
            disabled={rows.length === 0 || loading}
            onClick={emailAll}
          >
            Email all eligible
          </Button>
        </div>
      </div>

      {emailJobStatus && (
        <div className="px-4 sm:px-6 py-3 border-b border-border bg-blue-50 dark:bg-blue-500/10 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-blue-800 dark:text-blue-200">
              {emailJobStatus.done
                ? `Done — ${emailJobStatus.sent} sent, ${emailJobStatus.failed} failed.`
                : `Sending… ${emailJobStatus.processed} / ${emailJobStatus.total}.`}
            </div>
            {emailJobStatus.done && (
              <button
                type="button"
                onClick={() => setEmailJobStatus(null)}
                className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6">
        {loading ? (
          <SkeletonRows count={5} />
        ) : error ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Couldn't load receipts"
            description={error}
            cta={{ label: 'Retry', onClick: () => fetchRows(year) }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<DocumentArrowDownIcon className="h-10 w-10" />}
            title={`No dues payments recorded for ${year}`}
            description="Pick a different year above, or record some membership-dues payments first."
            cta={null}
          />
        ) : (
          <DataView<ReceiptRow>
            tableId={`tax-receipts-${year}`}
            rows={rows}
            rowKey={(r) => r.familyId}
            columns={columns}
            pageSize={20}
            exportFileName={`tax-receipts-${year}`}
            globalSearch={{
              placeholder: 'Search family or email…',
              getValue: (r) => `${r.familyName} ${r.email}`,
            }}
            mobileCard={(r) => (
              <div className="surface-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-fg">{r.familyName}</div>
                    <div className="text-xs text-fg-muted truncate">
                      {r.email || '(no email)'}
                    </div>
                  </div>
                  <div className="tabular font-semibold text-green-700 dark:text-green-400">
                    {formatMoney(r.totalPaid)}
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                    loading={downloadingId === r.familyId}
                    onClick={() => downloadOne(r)}
                  >
                    PDF
                  </Button>
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}
