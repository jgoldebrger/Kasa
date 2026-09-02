'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useToast } from '@/app/components/Toast'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin-constants'
import { useT } from '@/lib/client/i18n'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataView,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'

type AuditEntry = {
  id: string
  createdAt: string
  action: string
  userId: string
  userName?: string | null
  userEmail?: string | null
  organizationId: string
  organizationName?: string | null
  organizationSlug?: string | null
  reason?: string | null
  readOnly?: boolean
  sessionId?: string | null
}

type SessionDetail = {
  id: string
  startedAt: string
  endedAt: string | null
  reason: string | null
  readOnly: boolean | null
  user: { id: string; name: string; email: string }
  organization: { id: string; name: string; slug: string }
}

type SessionAction = {
  action: string
  at: string
}

type SessionActionRow = SessionAction & { id: string }

type AppliedFilters = {
  action: string
  orgQ: string
  fromDate: string
  toDate: string
}

function actionBadge(action: string) {
  if (action === 'platform.impersonate.start') {
    return <Badge variant="warning">Start</Badge>
  }
  if (action === 'platform.impersonate.end') {
    return <Badge variant="muted">End</Badge>
  }
  return <Badge variant="default">{action}</Badge>
}

function buildFilterParams(filters: AppliedFilters, cursor?: string | null) {
  const qs = new URLSearchParams()
  if (filters.action) qs.set('action', filters.action)
  if (filters.orgQ) qs.set('q', filters.orgQ)
  if (filters.fromDate) qs.set('fromDate', filters.fromDate)
  if (filters.toDate) qs.set('toDate', filters.toDate)
  if (cursor) qs.set('cursor', cursor)
  return qs
}

export default function SupportAuditAdminPage() {
  const toast = useToast()
  const t = useT()
  const searchParams = useSearchParams()
  const sessionIdFromUrl = searchParams.get('sessionId')?.trim() || ''

  const [rows, setRows] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)

  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null)
  const [sessionActions, setSessionActions] = useState<SessionAction[]>([])
  const [sessionLoading, setSessionLoading] = useState(false)

  const [actionInput, setActionInput] = useState('')
  const [orgQuery, setOrgQuery] = useState('')
  const [fromDateInput, setFromDateInput] = useState('')
  const [toDateInput, setToDateInput] = useState('')
  const [filters, setFilters] = useState<AppliedFilters>({
    action: '',
    orgQ: '',
    fromDate: '',
    toDate: '',
  })

  const loadSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        setSessionDetail(null)
        setSessionActions([])
        return
      }
      setSessionLoading(true)
      try {
        const res = await fetch(
          `/api/admin/impersonation-audit?sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}))
          if (data?.code === PLATFORM_ADMIN_2FA_REQUIRED_CODE) {
            setTwoFactorRequired(true)
            return
          }
          setForbidden(true)
          return
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || t('admin.supportAudit.sessionLoadFailed'))
          setSessionDetail(null)
          setSessionActions([])
          return
        }
        const data = await res.json()
        setSessionDetail((data.session || null) as SessionDetail | null)
        setSessionActions((data.actions || []) as SessionAction[])
      } catch {
        toast.error(t('admin.supportAudit.networkError'))
      } finally {
        setSessionLoading(false)
      }
    },
    [t, toast],
  )

  const load = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean; filters?: AppliedFilters }) => {
      setLoading(true)
      setTwoFactorRequired(false)
      try {
        const active = opts?.filters ?? filters
        const qs = buildFilterParams(active, opts?.cursor)
        const res = await fetch(`/api/admin/impersonation-audit?${qs.toString()}`)
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}))
          if (data?.code === PLATFORM_ADMIN_2FA_REQUIRED_CODE) {
            setTwoFactorRequired(true)
            return
          }
          setForbidden(true)
          return
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || t('admin.supportAudit.loadFailed'))
          return
        }
        const data = await res.json()
        const raw = (data.entries || data.auditEntries || []) as Array<{
          id: string
          createdAt: string
          action: string
          reason?: string | null
          readOnly?: boolean | null
          sessionId?: string | null
          user?: { id: string; name?: string; email?: string } | null
          organization?: { id: string; name?: string; slug?: string } | null
        }>
        const list: AuditEntry[] = raw.map((entry) => ({
          id: entry.id,
          createdAt: entry.createdAt,
          action: entry.action,
          userId: entry.user?.id ?? '',
          userName: entry.user?.name ?? null,
          userEmail: entry.user?.email ?? null,
          organizationId: entry.organization?.id ?? '',
          organizationName: entry.organization?.name ?? null,
          organizationSlug: entry.organization?.slug ?? null,
          reason: entry.reason ?? null,
          readOnly: entry.readOnly === true,
          sessionId: entry.sessionId ?? null,
        }))
        setRows((prev) => (opts?.append ? [...prev, ...list] : list))
        setNextCursor(data.nextCursor || null)
      } catch {
        toast.error(t('admin.supportAudit.networkError'))
      } finally {
        setLoading(false)
      }
    },
    [filters, t, toast],
  )

  useEffect(() => {
    if (sessionIdFromUrl) {
      void loadSession(sessionIdFromUrl)
    } else {
      setSessionDetail(null)
      setSessionActions([])
    }
  }, [sessionIdFromUrl, loadSession])

  useEffect(() => {
    if (!sessionIdFromUrl) {
      void load()
    }
  }, [load, sessionIdFromUrl])

  function applyFilters(e: React.FormEvent) {
    e.preventDefault()
    const next: AppliedFilters = {
      action: actionInput,
      orgQ: orgQuery.trim(),
      fromDate: fromDateInput,
      toDate: toDateInput,
    }
    setFilters(next)
    void load({ filters: next })
  }

  function exportCsv() {
    const qs = buildFilterParams(filters)
    qs.set('format', 'csv')
    window.location.href = `/api/admin/impersonation-audit?${qs.toString()}`
  }

  const sessionActionRows = useMemo<SessionActionRow[]>(
    () =>
      sessionActions.map((row, index) => ({
        ...row,
        id: `${row.action}-${row.at}-${index}`,
      })),
    [sessionActions],
  )

  const sessionActionColumns = useMemo<DataColumn<SessionActionRow>[]>(
    () => [
      {
        id: 'at',
        header: t('admin.supportAudit.colTime'),
        headerText: t('admin.supportAudit.colTime'),
        cell: (row) => (
          <span className="whitespace-nowrap text-fg-muted">
            {row.at ? new Date(row.at).toLocaleString() : '—'}
          </span>
        ),
        exportValue: (row) => (row.at ? new Date(row.at) : ''),
      },
      {
        id: 'action',
        header: t('admin.supportAudit.colAction'),
        headerText: t('admin.supportAudit.colAction'),
        cell: (row) => <code className="font-mono text-xs">{row.action}</code>,
        exportValue: (row) => row.action,
      },
    ],
    [t],
  )

  const auditColumns = useMemo<DataColumn<AuditEntry>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('admin.supportAudit.colTime'),
        headerText: t('admin.supportAudit.colTime'),
        cell: (row) => (
          <span className="whitespace-nowrap text-fg-muted">
            {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
          </span>
        ),
        exportValue: (row) => (row.createdAt ? new Date(row.createdAt) : ''),
      },
      {
        id: 'user',
        header: t('admin.supportAudit.colAdmin'),
        headerText: t('admin.supportAudit.colAdmin'),
        cell: (row) => (
          <>
            <div>{row.userName || row.userId}</div>
            {row.userEmail && <div className="text-xs">{row.userEmail}</div>}
          </>
        ),
        exportValue: (row) => row.userEmail || row.userName || row.userId,
      },
      {
        id: 'organization',
        header: t('admin.supportAudit.colOrganization'),
        headerText: t('admin.supportAudit.colOrganization'),
        cell: (row) => (
          <>
            <div className="font-medium text-fg">{row.organizationName || '—'}</div>
            {row.organizationSlug && (
              <div className="text-xs font-mono text-fg-muted">{row.organizationSlug}</div>
            )}
          </>
        ),
        exportValue: (row) => row.organizationName || row.organizationSlug || '',
      },
      {
        id: 'action',
        header: t('admin.supportAudit.colAction'),
        headerText: t('admin.supportAudit.colAction'),
        cell: (row) => actionBadge(row.action),
        exportValue: (row) => row.action,
      },
      {
        id: 'reason',
        header: t('admin.supportAudit.colReason'),
        headerText: t('admin.supportAudit.colReason'),
        cell: (row) => (
          <span className="max-w-xs text-fg-muted">
            {row.reason || (row.action === 'platform.impersonate.start' ? '—' : '')}
          </span>
        ),
        exportValue: (row) => row.reason || '',
      },
      {
        id: 'readOnly',
        header: t('admin.supportAudit.colReadOnly'),
        headerText: t('admin.supportAudit.colReadOnly'),
        cell: (row) =>
          row.action === 'platform.impersonate.start' ? (
            row.readOnly ? (
              <Badge variant="warning">{t('admin.supportAudit.readOnlyYes')}</Badge>
            ) : (
              <Badge variant="muted">{t('admin.supportAudit.readOnlyNo')}</Badge>
            )
          ) : (
            '—'
          ),
        exportValue: (row) =>
          row.action === 'platform.impersonate.start' ? (row.readOnly ? 'yes' : 'no') : '',
      },
      {
        id: 'session',
        header: t('admin.supportAudit.colSession'),
        headerText: t('admin.supportAudit.colSession'),
        sortable: false,
        cell: (row) =>
          row.sessionId ? (
            <Link
              href={`/admin/support-audit?sessionId=${encodeURIComponent(row.sessionId)}`}
              className="text-sm font-medium text-accent hover:text-accent-hover"
            >
              {t('admin.supportAudit.viewSession')}
            </Link>
          ) : (
            '—'
          ),
        exportValue: () => '',
      },
    ],
    [t],
  )

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Alert variant="danger" title={t('admin.supportAudit.accessDeniedTitle')}>
          {t('admin.supportAudit.accessDeniedBody')}{' '}
          <code className="text-xs">PLATFORM_ADMIN_EMAILS</code>.
        </Alert>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <PageHeader
        title={t('admin.supportAudit.title')}
        subtitle={t('admin.supportAudit.subtitle')}
        actions={
          <ButtonLink href="/admin" variant="secondary" size="sm">
            {t('admin.supportMode.adminHub')}
          </ButtonLink>
        }
      />

      {twoFactorRequired ? (
        <Alert variant="warning" title={t('admin.supportAudit.twoFactorTitle')}>
          <p>{t('admin.supportAudit.twoFactorBody')}</p>
          <Link
            href="/account"
            className="mt-2 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
          >
            {t('admin.supportAudit.twoFactorLink')} →
          </Link>
        </Alert>
      ) : sessionIdFromUrl ? (
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-fg">
                {t('admin.supportAudit.sessionTitle')}
              </h2>
              <p className="text-sm text-fg-muted">{t('admin.supportAudit.sessionSubtitle')}</p>
            </div>
            <ButtonLink href="/admin/support-audit" variant="secondary" size="sm">
              {t('admin.supportAudit.backToList')}
            </ButtonLink>
          </div>

          {sessionLoading ? (
            <SkeletonRows count={4} />
          ) : !sessionDetail ? (
            <EmptyState title={t('admin.supportAudit.sessionNotFound')} />
          ) : (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-fg-muted">{t('admin.supportAudit.colOrganization')}</dt>
                  <dd className="font-medium">
                    {sessionDetail.organization.name || '—'}
                    {sessionDetail.organization.slug && (
                      <span className="block text-xs font-mono text-fg-muted">
                        {sessionDetail.organization.slug}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">{t('admin.supportAudit.colAdmin')}</dt>
                  <dd>
                    {sessionDetail.user.name || sessionDetail.user.id}
                    {sessionDetail.user.email && (
                      <span className="block text-xs text-fg-muted">
                        {sessionDetail.user.email}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">{t('admin.supportAudit.sessionStarted')}</dt>
                  <dd>{new Date(sessionDetail.startedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">{t('admin.supportAudit.sessionEnded')}</dt>
                  <dd>
                    {sessionDetail.endedAt
                      ? new Date(sessionDetail.endedAt).toLocaleString()
                      : t('admin.supportAudit.sessionActive')}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">{t('admin.supportAudit.colReason')}</dt>
                  <dd>{sessionDetail.reason || '—'}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">{t('admin.supportAudit.colReadOnly')}</dt>
                  <dd>
                    {sessionDetail.readOnly ? (
                      <Badge variant="warning">{t('admin.supportAudit.readOnlyYes')}</Badge>
                    ) : (
                      <Badge variant="muted">{t('admin.supportAudit.readOnlyNo')}</Badge>
                    )}
                  </dd>
                </div>
              </dl>

              <div>
                <h3 className="text-sm font-semibold text-fg mb-2">
                  {t('admin.supportAudit.sessionActionsTitle').replace(
                    '{count}',
                    String(sessionActions.length),
                  )}
                </h3>
                {sessionActions.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    {t('admin.supportMode.sessionSummaryEmpty')}
                  </p>
                ) : (
                  <DataView
                    tableId="admin-support-audit-session-actions"
                    rows={sessionActionRows}
                    columns={sessionActionColumns}
                    rowKey={(row) => row.id}
                    toolbar={false}
                    defaultSort={{ id: 'at', dir: 'desc' }}
                    mobileCard={(row) => (
                      <Card compact>
                        <p className="text-xs text-fg-muted">
                          {row.at ? new Date(row.at).toLocaleString() : '—'}
                        </p>
                        <code className="mt-1 block font-mono text-xs text-fg">{row.action}</code>
                      </Card>
                    )}
                  />
                )}
              </div>
            </>
          )}
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <form
              className="flex flex-col gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-5 sm:items-end"
              onSubmit={applyFilters}
            >
              <Select
                label={t('admin.supportAudit.filterAction')}
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
              >
                <option value="">{t('admin.supportAudit.filterAllActions')}</option>
                <option value="start">{t('admin.supportAudit.filterStart')}</option>
                <option value="end">{t('admin.supportAudit.filterEnd')}</option>
              </Select>
              <Input
                label={t('admin.supportAudit.filterOrganization')}
                type="search"
                placeholder={t('admin.supportAudit.filterOrganizationPlaceholder')}
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
              />
              <Input
                label={t('admin.supportAudit.filterFrom')}
                type="date"
                value={fromDateInput}
                onChange={(e) => setFromDateInput(e.target.value)}
              />
              <Input
                label={t('admin.supportAudit.filterTo')}
                type="date"
                value={toDateInput}
                onChange={(e) => setToDateInput(e.target.value)}
              />
              <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
                <Button type="submit">{t('admin.supportAudit.search')}</Button>
                <Button type="button" variant="secondary" onClick={exportCsv}>
                  {t('admin.supportAudit.exportCsv')}
                </Button>
              </div>
            </form>
          </Card>

          {loading && rows.length === 0 ? (
            <SkeletonRows count={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('admin.supportAudit.emptyTitle')}
              description={t('admin.supportAudit.emptyDescription')}
            />
          ) : (
            <DataView
              tableId="admin-support-audit"
              rows={rows}
              columns={auditColumns}
              rowKey={(row) => row.id}
              defaultSort={{ id: 'createdAt', dir: 'desc' }}
              mobileCard={(row) => (
                <Card compact>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-fg">{row.organizationName || '—'}</p>
                      <p className="text-xs text-fg-muted">
                        {row.userName || row.userEmail || row.userId}
                      </p>
                    </div>
                    {actionBadge(row.action)}
                  </div>
                  <p className="mt-2 text-xs text-fg-muted">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                  </p>
                  {row.sessionId && (
                    <Link
                      href={`/admin/support-audit?sessionId=${encodeURIComponent(row.sessionId)}`}
                      className="mt-2 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
                    >
                      {t('admin.supportAudit.viewSession')}
                    </Link>
                  )}
                </Card>
              )}
            />
          )}

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="secondary"
                loading={loading}
                onClick={() => load({ cursor: nextCursor, append: true })}
              >
                {t('admin.supportAudit.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
