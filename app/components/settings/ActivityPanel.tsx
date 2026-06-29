'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDownTrayIcon, ClockIcon } from '@heroicons/react/24/outline'
import ReadOnlySupportGuard from '@/app/components/ReadOnlySupportGuard'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import {
  Button,
  Card,
  DataView,
  EmptyState,
  Input,
  Select,
  type DataColumn,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'

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

interface ActivitySettings {
  auditLogRetentionDays: number | null
  effectiveRetentionDays: number
  platformDefaultRetentionDays: number
  minRetentionDays: number
  maxRetentionDays: number
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
  isOwner: boolean
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
  isOwner,
}: Props) {
  const t = useT()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [activitySettings, setActivitySettings] = useState<ActivitySettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsLoadError, setSettingsLoadError] = useState(false)
  const [retentionInput, setRetentionInput] = useState('')
  const [retentionSaving, setRetentionSaving] = useState(false)

  const loadActivitySettings = useCallback(async () => {
    setSettingsLoading(true)
    setSettingsLoadError(false)
    try {
      const res = await fetch('/api/organizations/activity')
      if (!res.ok) {
        setSettingsLoadError(true)
        return
      }
      const data = await res.json().catch(() => ({}))
      const settings: ActivitySettings = {
        auditLogRetentionDays: data.auditLogRetentionDays ?? null,
        effectiveRetentionDays: Number(data.effectiveRetentionDays) || 400,
        platformDefaultRetentionDays: Number(data.platformDefaultRetentionDays) || 400,
        minRetentionDays: Number(data.minRetentionDays) || 90,
        maxRetentionDays: Number(data.maxRetentionDays) || 400,
      }
      setActivitySettings(settings)
      setRetentionInput(
        settings.auditLogRetentionDays != null
          ? String(settings.auditLogRetentionDays)
          : String(settings.platformDefaultRetentionDays),
      )
    } catch {
      setSettingsLoadError(true)
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadActivitySettings()
  }, [loadActivitySettings])

  const handleRetentionSave = async () => {
    if (!isOwner || !activitySettings) return
    const parsed = Number(retentionInput)
    if (!Number.isFinite(parsed)) return
    const days = Math.floor(parsed)
    if (days < activitySettings.minRetentionDays || days > activitySettings.maxRetentionDays) return

    const useDefault = days === activitySettings.platformDefaultRetentionDays
    const nextValue = useDefault ? null : days

    setRetentionSaving(true)
    try {
      const res = await fetch('/api/organizations/activity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditLogRetentionDays: nextValue }),
      })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      setActivitySettings((prev) =>
        prev
          ? {
              ...prev,
              auditLogRetentionDays: data.auditLogRetentionDays ?? null,
              effectiveRetentionDays:
                Number(data.effectiveRetentionDays) || prev.effectiveRetentionDays,
            }
          : prev,
      )
    } finally {
      setRetentionSaving(false)
    }
  }

  const actionOptions = Array.from(new Set(items.map((i) => i.action).filter(Boolean))).sort()
  const userOptions = Array.from(new Set(items.map((i) => i.userId).filter(Boolean) as string[]))
  const resourceTypeOptions = Array.from(
    new Set(items.map((i) => i.resourceType).filter(Boolean)),
  ).sort()

  const columns: DataColumn<AuditItem>[] = [
    {
      id: 'when',
      header: t('settings.activity.column.when'),
      headerText: t('settings.activity.column.when'),
      cell: (i) => (
        <span className="tabular text-sm text-fg">{new Date(i.createdAt).toLocaleString()}</span>
      ),
      exportValue: (i) => (i.createdAt ? new Date(i.createdAt) : ''),
    },
    {
      id: 'who',
      header: t('settings.activity.column.who'),
      headerText: t('settings.activity.column.who'),
      cell: (i) => {
        if (!i.userId)
          return <span className="text-fg-muted italic">{t('settings.activity.systemActor')}</span>
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
      header: t('settings.activity.column.action'),
      headerText: t('settings.activity.column.action'),
      cell: (i) => <code className="text-xs text-fg">{i.action}</code>,
      exportValue: (i) => i.action,
    },
    {
      id: 'resource',
      header: t('settings.activity.column.resource'),
      headerText: t('settings.activity.column.resource'),
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
      header: t('settings.activity.column.ip'),
      headerText: t('settings.activity.column.ip'),
      cell: (i) => <span className="tabular text-xs text-fg-muted">{i.ip || ''}</span>,
      exportValue: (i) => i.ip || '',
    },
  ]

  const effectiveDays = activitySettings?.effectiveRetentionDays ?? 400

  return (
    <>
      <SettingsPanel
        icon={<ClockIcon />}
        title={t('settings.activity.retention.title')}
        description={t('settings.activity.retention.description').replace(
          '{days}',
          String(effectiveDays),
        )}
        className="mb-6"
      >
        <ReadOnlySupportGuard className="mb-4" />

        {settingsLoadError && (
          <p className="mb-4 text-sm text-danger">{t('settings.activity.retention.loadError')}</p>
        )}

        <Card compact>
          <p className="text-sm text-fg">
            {t('settings.activity.retention.policy')
              .replace('{days}', String(effectiveDays))
              .replace(
                '{platformDays}',
                String(activitySettings?.platformDefaultRetentionDays ?? 400),
              )}
          </p>
          <p className="mt-2 text-xs text-fg-muted">
            {t('settings.activity.retention.ttlNote').replace(
              '{maxDays}',
              String(activitySettings?.maxRetentionDays ?? 400),
            )}
          </p>

          {settingsLoading ? (
            <p className="mt-3 text-sm text-fg-muted">{t('settings.activity.retention.loading')}</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <Input
                label={t('settings.activity.retention.daysLabel')}
                type="number"
                min={activitySettings?.minRetentionDays ?? 90}
                max={activitySettings?.maxRetentionDays ?? 400}
                value={retentionInput}
                disabled={!isOwner || supportReadOnly || retentionSaving}
                onChange={(e) => setRetentionInput(e.target.value)}
                hint={t('settings.activity.retention.daysHint')
                  .replace('{min}', String(activitySettings?.minRetentionDays ?? 90))
                  .replace('{max}', String(activitySettings?.maxRetentionDays ?? 400))}
              />
              {isOwner && !supportReadOnly && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={retentionSaving}
                  onClick={() => void handleRetentionSave()}
                >
                  {t('settings.activity.retention.save')}
                </Button>
              )}
            </div>
          )}
          {!isOwner && !settingsLoading && (
            <p className="mt-2 text-xs text-fg-muted">
              {t('settings.activity.retention.ownerOnly')}
            </p>
          )}
        </Card>
      </SettingsPanel>

      <SettingsPanel
        icon={<ClockIcon />}
        title={t('settings.activity.title')}
        description={t('settings.activity.description')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
            onClick={onExportCsv}
            title={t('settings.activity.exportCsvTitle')}
          >
            {t('settings.activity.exportCsv')}
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <Select
            label={t('settings.activity.filter.action')}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">{t('settings.activity.filter.allActions')}</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Select
            label={t('settings.activity.filter.user')}
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="">{t('settings.activity.filter.allUsers')}</option>
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
            label={t('settings.activity.filter.resource')}
            value={resourceTypeFilter}
            onChange={(e) => setResourceTypeFilter(e.target.value)}
          >
            <option value="">{t('settings.activity.filter.allResources')}</option>
            {resourceTypeOptions.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
          </Select>
          <Input
            label={t('settings.activity.filter.from')}
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <Input
            label={t('settings.activity.filter.to')}
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        {items.length === 0 && !loading ? (
          <EmptyState
            icon={<ClockIcon className="h-10 w-10" />}
            title={t('settings.activity.empty.title')}
            description={t('settings.activity.empty.description')}
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
                placeholder: t('settings.activity.searchPlaceholder'),
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
                      : t('settings.activity.systemActor')}
                  </div>
                </div>
              )}
            />
            {nextCursor && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" loading={loading} onClick={onLoadMore}>
                  {t('settings.activity.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </SettingsPanel>
    </>
  )
}
