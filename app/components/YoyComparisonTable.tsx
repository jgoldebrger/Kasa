'use client'

import { useMemo } from 'react'
import { Card, DataView, type DataColumn } from '@/app/components/ui'
import type { YoYMetric } from '@/lib/reports/yoy'

type YoYRow = YoYMetric & { id: string }

interface YoyComparisonTableProps {
  tableId: string
  rows: YoYMetric[]
  metricColumnLabel: string
  priorYearLabel: string
  currentYearLabel: string
  changeColumnLabel: string
  formatMoney: (amount: number) => string
}

export default function YoyComparisonTable({
  tableId,
  rows,
  metricColumnLabel,
  priorYearLabel,
  currentYearLabel,
  changeColumnLabel,
  formatMoney,
}: YoyComparisonTableProps) {
  const data = useMemo<YoYRow[]>(
    () => rows.map((row, index) => ({ ...row, id: String(index) })),
    [rows],
  )

  const columns = useMemo<DataColumn<YoYRow>[]>(
    () => [
      {
        id: 'metric',
        header: metricColumnLabel,
        headerText: metricColumnLabel,
        cell: (row) => <span className="text-fg">{row.label}</span>,
        exportValue: (row) => row.label,
      },
      {
        id: 'prior',
        header: priorYearLabel,
        headerText: priorYearLabel,
        align: 'right',
        cell: (row) => <span className="tabular text-fg-muted">{formatMoney(row.prior)}</span>,
        exportValue: (row) => row.prior,
      },
      {
        id: 'current',
        header: currentYearLabel,
        headerText: currentYearLabel,
        align: 'right',
        cell: (row) => <span className="tabular text-fg">{formatMoney(row.current)}</span>,
        exportValue: (row) => row.current,
      },
      {
        id: 'change',
        header: changeColumnLabel,
        headerText: changeColumnLabel,
        align: 'right',
        cell: (row) => (
          <span
            className={`tabular font-medium ${row.delta >= 0 ? 'text-success' : 'text-danger'}`}
          >
            {formatMoney(row.delta)}
            {row.deltaPct != null && (
              <span className="ml-1 text-xs text-fg-muted">
                ({row.deltaPct >= 0 ? '+' : ''}
                {row.deltaPct.toFixed(1)}%)
              </span>
            )}
          </span>
        ),
        exportValue: (row) => row.delta,
      },
    ],
    [changeColumnLabel, currentYearLabel, formatMoney, metricColumnLabel, priorYearLabel],
  )

  return (
    <DataView
      tableId={tableId}
      rows={data}
      columns={columns}
      rowKey={(row) => row.id}
      toolbar={false}
      defaultSort={{ id: 'metric', dir: 'asc' }}
      mobileCard={(row) => (
        <Card compact>
          <p className="font-medium text-fg">{row.label}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-fg-muted">{priorYearLabel}</dt>
              <dd className="tabular text-fg-muted">{formatMoney(row.prior)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{currentYearLabel}</dt>
              <dd className="tabular text-fg">{formatMoney(row.current)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-fg-muted">{changeColumnLabel}</dt>
              <dd
                className={`tabular font-medium ${row.delta >= 0 ? 'text-success' : 'text-danger'}`}
              >
                {formatMoney(row.delta)}
                {row.deltaPct != null && (
                  <span className="ml-1 text-fg-muted">
                    ({row.deltaPct >= 0 ? '+' : ''}
                    {row.deltaPct.toFixed(1)}%)
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    />
  )
}
