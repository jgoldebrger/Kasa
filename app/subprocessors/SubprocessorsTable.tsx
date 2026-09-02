'use client'

import { useMemo } from 'react'
import { Card, DataView, type DataColumn } from '@/app/components/ui'
import type { Subprocessor } from '@/lib/legal/subprocessors'

export default function SubprocessorsTable({ rows }: { rows: readonly Subprocessor[] }) {
  const columns = useMemo<DataColumn<Subprocessor>[]>(
    () => [
      {
        id: 'name',
        header: 'Subprocessor',
        headerText: 'Subprocessor',
        cell: (row) => (
          <a
            href={row.website}
            className="text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.name}
          </a>
        ),
        exportValue: (row) => row.name,
      },
      {
        id: 'purpose',
        header: 'Purpose',
        headerText: 'Purpose',
        cell: (row) => <span className="text-fg-muted">{row.purpose}</span>,
        exportValue: (row) => row.purpose,
      },
      {
        id: 'location',
        header: 'Location',
        headerText: 'Location',
        cell: (row) => <span className="text-fg-muted text-xs">{row.location}</span>,
        exportValue: (row) => row.location,
      },
    ],
    [],
  )

  return (
    <DataView
      tableId="subprocessors"
      rows={[...rows]}
      columns={columns}
      rowKey={(row) => row.name}
      toolbar={false}
      defaultSort={{ id: 'name', dir: 'asc' }}
      mobileCard={(row) => (
        <Card compact>
          <a
            href={row.website}
            className="font-medium text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.name}
          </a>
          <p className="mt-1 text-sm text-fg-muted">{row.purpose}</p>
          <p className="mt-1 text-xs text-fg-muted">{row.location}</p>
        </Card>
      )}
    />
  )
}
