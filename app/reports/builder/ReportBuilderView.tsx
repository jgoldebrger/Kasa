'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast, useConfirm } from '@/app/components/Toast'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { Button, Input, PageHeader, Select, SkeletonRows } from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'

interface ColumnDef {
  id: string
  label: string
  type: 'string' | 'number' | 'date'
}
interface SourceDef {
  id: 'payments' | 'events' | 'members' | 'families'
  label: string
  dateField: string
  dimensions: ColumnDef[]
  measures: ColumnDef[]
}

interface ReportConfig {
  source: SourceDef['id']
  rowDim: string
  colDim: string
  measure: string
  aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max'
  fromDate: string
  toDate: string
}

interface SavedReport {
  _id: string
  name: string
  source: string
  config: any
}

interface ReportResult {
  rowLabels: string[]
  colLabels: string[]
  values: Record<string, Record<string, number>>
  totals: { rows: Record<string, number>; cols: Record<string, number>; grand: number }
  rowCount: number
}

const AGGREGATE_LABELS: Record<ReportConfig['aggregate'], string> = {
  count: 'Count of rows',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
}

function emptyConfig(source: SourceDef['id']): ReportConfig {
  return {
    source,
    rowDim: '',
    colDim: '',
    measure: '',
    aggregate: 'count',
    fromDate: '',
    toDate: '',
  }
}

export default function ReportBuilderView({
  initialSources,
}: {
  initialSources?: SourceDef[]
} = {}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { format } = useCurrency()
  const sourcesHydrated = initialSources !== undefined
  const [sources, setSources] = useState<SourceDef[]>(initialSources ?? [])
  const [saved, setSaved] = useState<SavedReport[]>([])
  const [config, setConfig] = useState<ReportConfig>(emptyConfig('payments'))
  const [result, setResult] = useState<ReportResult | null>(null)
  const [running, setRunning] = useState(false)
  const [savingName, setSavingName] = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const loadSavedReports = useCallback(async () => {
    const gen = begin()
    try {
      const savedRes = await fetch('/api/reports/saved')
      if (isStale(gen)) return
      if (savedRes.ok) {
        const savedData = await savedRes.json().catch(() => ({}))
        if (isStale(gen)) return
        setSaved(savedData?.reports || [])
      } else if (!isStale(gen)) {
        setSaved([])
      }
    } catch {
      if (isStale(gen)) return
      setSaved([])
    }
  }, [begin, isStale])

  const loadMeta = useCallback(async () => {
    const gen = begin()
    try {
      const metaRes = await fetch('/api/reports/meta')
      if (isStale(gen)) return
      if (metaRes.ok) {
        const meta = await metaRes.json().catch(() => ({}))
        if (isStale(gen)) return
        setSources(meta?.sources || [])
      } else if (!isStale(gen)) {
        setSources([])
      }
    } catch {
      if (isStale(gen)) return
      setSources([])
    }
  }, [begin, isStale])

  useEffect(() => {
    if (!sourcesHydrated) {
      void loadMeta()
    }
    const schedule =
      typeof requestIdleCallback === 'function'
        ? (cb: () => void) => requestIdleCallback(cb)
        : (cb: () => void) => window.setTimeout(cb, 0)
    const id = schedule(() => {
      void loadSavedReports()
    })
    const cancel =
      typeof cancelIdleCallback === 'function'
        ? (id: number) => cancelIdleCallback(id)
        : (id: number) => window.clearTimeout(id)
    return () => cancel(id as unknown as number)
  }, [sourcesHydrated, loadMeta, loadSavedReports])

  useOrgChanged(useCallback(() => {
    invalidate()
    setResult(null)
    setConfig(emptyConfig('payments'))
    if (!sourcesHydrated) void loadMeta()
    void loadSavedReports()
  }, [loadMeta, loadSavedReports, invalidate, sourcesHydrated]))

  const currentSource = useMemo(
    () => sources.find((s) => s.id === config.source) || null,
    [sources, config.source],
  )

  const isMoneyMeasure = config.measure === 'amount' && config.aggregate !== 'count'

  const runQuery = useCallback(async () => {
    const gen = begin()
    setRunning(true)
    try {
      const res = await fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json().catch(() => ({}))
      if (isStale(gen)) return
      if (!res.ok) {
        toast.error(data.error || 'Could not run report.')
        return
      }
      setResult(data)
    } catch {
      if (isStale(gen)) return
      toast.error('Network error.')
    } finally {
      if (!isStale(gen)) setRunning(false)
    }
  }, [config, toast, begin, isStale])

  const loadSaved = (report: SavedReport) => {
    setConfig({
      source: report.config?.source || (report.source as any) || 'payments',
      rowDim: report.config?.rowDim || '',
      colDim: report.config?.colDim || '',
      measure: report.config?.measure || '',
      aggregate: report.config?.aggregate || 'count',
      fromDate: report.config?.fromDate || '',
      toDate: report.config?.toDate || '',
    })
  }

  const saveReport = async () => {
    const name = savingName.trim()
    if (!name) {
      toast.error('Give the report a name first.')
      return
    }
    try {
      const res = await fetch('/api/reports/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          source: config.source,
          config,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save report.')
        return
      }
      toast.success(`Saved "${name}".`)
      setShowSaveForm(false)
      setSavingName('')
      // Refresh the saved list.
      const listRes = await fetch('/api/reports/saved')
      if (listRes.ok) {
        const list = await listRes.json().catch(() => ({}))
        setSaved(list?.reports || [])
      }
    } catch {
      toast.error('Network error.')
    }
  }

  const deleteReport = async (report: SavedReport) => {
    const ok = await confirm({
      title: `Delete "${report.name}"?`,
      message: 'This only removes the saved view — the underlying data is not affected.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/reports/saved/${report._id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Could not delete report.')
        return
      }
      setSaved((prev) => prev.filter((r) => r._id !== report._id))
      toast.success('Deleted.')
    } catch {
      toast.error('Network error.')
    }
  }

  const exportCsv = () => {
    if (!result) return
    const lines: string[] = []
    const headerRow = ['', ...result.colLabels, 'Total']
    lines.push(headerRow.map(csv).join(','))
    for (const rl of result.rowLabels) {
      const cells = [csv(rl)]
      for (const cl of result.colLabels) {
        cells.push(String(result.values[rl]?.[cl] ?? 0))
      }
      cells.push(String(result.totals.rows[rl] ?? 0))
      lines.push(cells.join(','))
    }
    const totalsRow = ['Total']
    for (const cl of result.colLabels) {
      totalsRow.push(String(result.totals.cols[cl] ?? 0))
    }
    totalsRow.push(String(result.totals.grand))
    lines.push(totalsRow.join(','))

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${config.source}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const fmt = (n: number) => (isMoneyMeasure ? format(n) : Number(n).toLocaleString())

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Report builder"
          subtitle="Pivot your data: pick what to count, what to group by, and save the view to use later."
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Saved reports sidebar */}
          <aside className="lg:col-span-1">
            <div className="surface-card p-4 sticky top-4 space-y-3">
              <h3 className="text-sm font-semibold text-fg">Saved views</h3>
              {saved.length === 0 ? (
                <p className="text-xs text-fg-muted">
                  No saved reports yet. Configure a report and click "Save view" to remember it.
                </p>
              ) : (
                <ul className="space-y-1">
                  {saved.map((r) => (
                    <li key={r._id} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => loadSaved(r)}
                        className="flex-1 min-w-0 text-left rounded px-2 py-1.5 text-sm text-fg hover:bg-fg/5"
                      >
                        <p className="truncate">{r.name}</p>
                        <p className="text-[10px] text-fg-muted uppercase">{r.source}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteReport(r)}
                        aria-label={`Delete ${r.name}`}
                        className="text-xs text-fg-muted hover:text-red-600"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Builder + Results */}
          <section className="lg:col-span-3 space-y-4">
            <div className="surface-card p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select
                  label="Data source"
                  value={config.source}
                  onChange={(e) =>
                    setConfig(emptyConfig(e.target.value as SourceDef['id']))
                  }
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Aggregate"
                  value={config.aggregate}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      aggregate: e.target.value as ReportConfig['aggregate'],
                    }))
                  }
                >
                  {Object.entries(AGGREGATE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Measure"
                  value={config.measure}
                  onChange={(e) => setConfig((c) => ({ ...c, measure: e.target.value }))}
                  disabled={config.aggregate === 'count' || !currentSource?.measures.length}
                  hint={
                    config.aggregate === 'count'
                      ? 'Not used when counting rows.'
                      : undefined
                  }
                >
                  <option value="">— Select —</option>
                  {currentSource?.measures.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select
                  label="Group rows by"
                  value={config.rowDim}
                  onChange={(e) => setConfig((c) => ({ ...c, rowDim: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {currentSource?.dimensions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Split columns by"
                  value={config.colDim}
                  onChange={(e) => setConfig((c) => ({ ...c, colDim: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {currentSource?.dimensions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label={`From ${currentSource?.dateField || 'date'}`}
                  type="date"
                  value={config.fromDate}
                  onChange={(e) => setConfig((c) => ({ ...c, fromDate: e.target.value }))}
                />
                <Input
                  label={`To ${currentSource?.dateField || 'date'}`}
                  type="date"
                  value={config.toDate}
                  onChange={(e) => setConfig((c) => ({ ...c, toDate: e.target.value }))}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-end">
                {showSaveForm ? (
                  <>
                    <Input
                      label=""
                      placeholder="Saved-view name"
                      value={savingName}
                      onChange={(e) => setSavingName(e.target.value)}
                      maxLength={120}
                    />
                    <Button variant="ghost" onClick={() => setShowSaveForm(false)}>
                      Cancel
                    </Button>
                    <Button onClick={saveReport}>Save</Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setShowSaveForm(true)}>
                    Save view…
                  </Button>
                )}
                {result && (
                  <Button variant="secondary" onClick={exportCsv}>
                    Export CSV
                  </Button>
                )}
                <Button onClick={runQuery} loading={running}>
                  Run report
                </Button>
              </div>
            </div>

            <div className="surface-card p-4">
              {running ? (
                <SkeletonRows count={6} />
              ) : !result ? (
                <p className="text-sm text-fg-muted">
                  Configure the report and click "Run report" to see results here.
                </p>
              ) : result.rowLabels.length === 0 && result.colLabels.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  Query returned no rows. Try widening the date range or removing filters.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <p className="text-xs text-fg-muted mb-2">
                    {result.rowCount.toLocaleString()} source row{result.rowCount === 1 ? '' : 's'} aggregated.
                  </p>
                  <table className="min-w-full text-sm">
                    <thead className="bg-app-subtle">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-fg">
                          {currentSource?.dimensions.find((d) => d.id === config.rowDim)?.label ||
                            'Group'}
                        </th>
                        {result.colLabels.map((cl) => (
                          <th
                            key={cl}
                            className="text-right px-3 py-2 font-semibold text-fg whitespace-nowrap"
                          >
                            {cl}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 font-semibold text-fg">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rowLabels.map((rl) => (
                        <tr key={rl} className="border-t border-border">
                          <td className="px-3 py-2 text-fg">{rl}</td>
                          {result.colLabels.map((cl) => (
                            <td key={cl} className="text-right px-3 py-2 tabular text-fg">
                              {fmt(result.values[rl]?.[cl] ?? 0)}
                            </td>
                          ))}
                          <td className="text-right px-3 py-2 tabular text-fg font-medium">
                            {fmt(result.totals.rows[rl] ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-app-subtle">
                        <td className="px-3 py-2 font-semibold text-fg">Total</td>
                        {result.colLabels.map((cl) => (
                          <td
                            key={cl}
                            className="text-right px-3 py-2 tabular font-semibold text-fg"
                          >
                            {fmt(result.totals.cols[cl] ?? 0)}
                          </td>
                        ))}
                        <td className="text-right px-3 py-2 tabular font-bold text-fg">
                          {fmt(result.totals.grand)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function csv(value: string): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}
