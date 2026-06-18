'use client'

import type React from 'react'
import { ArrowDownTrayIcon, ClockIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Button, DataView, EmptyState, Input, Select, type DataColumn } from '@/app/components/ui'

/**
 * Read-only audit-log viewer. Reads `AuditLog` rows for the active org
 * via `/api/audit-log`, cursor-paginated. Filters: action, user, date
 * range. No writes — this panel intentionally never calls back into
 * the audit pipeline.
 */

interface AuditItem {
  _id: string
  action: string
  resourceType: string
  resourceId: string | null
  userId: string | null
  metadata: any
  ip: string | null
  userAgent: string | null
  createdAt: string
}

interface Props {
  items: AuditItem[]
  nextCursor: string | null
  loading: boolean
  usersMap: Record<string, { name?: string; email?: string }>
  actionFilter: string
  setActionFilter: (s: string) => void
  userFilter: string
  setUserFilter: (s: string) => void
  resourceTypeFilter: string
  setResourceTypeFilter: (s: string) => void
  fromDate: string
  setFromDate: (s: string) => void
  toDate: string
  setToDate: (s: string) => void
  onLoadMore: () => void
  onExportCsv: () => void
}

function shortId(id: string | null) {
  if (!id) return ''
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

export default function ActivityPanel({
  items,
  nextCursor,
  loading,
  usersMap,
  actionFilter,
  setActionFilter,
  userFilter,
  setUserFilter,
  resourceTypeFilter,
  setResourceTypeFilter,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  onLoadMore,
  onExportCsv,
}: Props) {
  // Derive the distinct action / user / resource values visible in the
  // current page so the dropdowns surface the realistic choices first.
  // We intentionally don't fetch a full distinct list — the action set
  // grows slowly and the visible page is a fine proxy.
  const actionOptions = Array.from(new Set(items.map((i) => i.action).filter(Boolean))).sort()
  const userOptions = Array.from(new Set(items.map((i) => i.userId).filter(Boolean) as string[]))
  const resourceTypeOptions = Array.from(
    new Set(items.map((i) => i.resourceType).filter(Boolean)),
  ).sort()

  const columns: DataColumn<AuditItem>[] = [
    {
      id: 'when',
      header: 'When',
      headerText: 'When',
      cell: (i) => (
        <span className="tabular text-sm text-fg">{new Date(i.createdAt).toLocaleString()}</span>
      ),
      exportValue: (i) => (i.createdAt ? new Date(i.createdAt) : ''),
    },
    {
      id: 'who',
      header: 'Who',
      headerText: 'Who',
      cell: (i) => {
        if (!i.userId) return <span className="text-fg-muted italic">system</span>
        const u = usersMap[i.userId]
        if (u?.name) return <span className="text-fg">{u.name}</span>
        if (u?.email) return <span className="text-fg">{u.email}</span>
        return <span className="tabular text-xs text-fg-muted">{shortId(i.userId)}</span>
      },
      exportValue: (i) =>
        i.userId ? usersMap[i.userId]?.name || usersMap[i.userId]?.email || i.userId : 'system',
    },
    {
      id: 'action',
      header: 'Action',
      headerText: 'Action',
      cell: (i) => <code className="text-xs text-fg">{i.action}</code>,
      exportValue: (i) => i.action,
    },
    {
      id: 'resource',
      header: 'Resource',
      headerText: 'Resource',
      cell: (i) => (
        <span className="text-fg">
          {i.resourceType}
          {i.resourceId ? (
            <span className="ml-2 tabular text-xs text-fg-muted">{shortId(i.resourceId)}</span>
          ) : null}
        </span>
      ),
      exportValue: (i) => `${i.resourceType}${i.resourceId ? ` ${i.resourceId}` : ''}`,
    },
    {
      id: 'ip',
      header: 'IP',
      headerText: 'IP',
      cell: (i) => <span className="tabular text-xs text-fg-muted">{i.ip || ''}</span>,
      exportValue: (i) => i.ip || '',
    },
  ]

  return (
    <SettingsPanel
      icon={<ClockIcon />}
      title="Activity log"
      description="Read-only audit of administrative actions in this organization."
      actions={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
          onClick={onExportCsv}
          title="Download the current filter set as a CSV (up to 10,000 rows)"
        >
          Export CSV
        </Button>
      }
    >
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Select
          label="Action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">All actions</option>
          {actionOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select label="User" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          <option value="">All users</option>
          {userOptions.map((u) => {
            const meta = usersMap[u]
            return (
              <option key={u} value={u}>
                {meta?.name || meta?.email || shortId(u)}
              </option>
            )
          })}
        </Select>
        <Select
          label="Resource"
          value={resourceTypeFilter}
          onChange={(e) => setResourceTypeFilter(e.target.value)}
        >
          <option value="">All resources</option>
          {resourceTypeOptions.map((rt) => (
            <option key={rt} value={rt}>
              {rt}
            </option>
          ))}
        </Select>
        <Input
          label="From"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>

      {items.length === 0 && !loading ? (
        <EmptyState
          icon={<ClockIcon className="h-10 w-10" />}
          title="No matching activity"
          description="Adjust the filters above or clear them to see the most recent events."
          cta={null}
        />
      ) : (
        <>
          <DataView<AuditItem>
            tableId="audit-log"
            rows={items}
            rowKey={(r) => r._id}
            columns={columns}
            pageSize={50}
            exportFileName="activity-log"
            globalSearch={{
              placeholder: 'Search action, resource…',
              getValue: (r) =>
                `${r.action} ${r.resourceType} ${r.resourceId || ''} ${r.userId || ''}`,
            }}
            mobileCard={(r) => (
              <div className="surface-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <code className="text-xs text-fg">{r.action}</code>
                    <div className="text-fg-muted text-xs mt-1">
                      {r.resourceType}
                      {r.resourceId ? ` · ${shortId(r.resourceId)}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-fg-muted tabular">
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="mt-1 text-xs text-fg-muted">
                  {r.userId
                    ? usersMap[r.userId]?.name || usersMap[r.userId]?.email || shortId(r.userId)
                    : 'system'}
                </div>
              </div>
            )}
          />
          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" loading={loading} onClick={onLoadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </SettingsPanel>
  )
}
