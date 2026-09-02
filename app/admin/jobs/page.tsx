'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/app/components/Toast'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin-constants'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'

type JobRunRow = {
  id: string
  name: string
  status: string
  startedAt: string
  completedAt: string | null
  processed: number
  failed: number
  lastError: string | null
  errorCount: number
  cursorIn: string | null
}

type EmailJobRow = {
  id: string
  organizationId: string
  kind: string
  status: string
  lastError: string | null
  processed: number
  failed: number
  sent: number
  createdAt: string
}

function statusBadge(row: JobRunRow) {
  if (row.status === 'failed') return <Badge variant="danger">failed</Badge>
  if (row.failed > 0) return <Badge variant="warning">partial</Badge>
  if (row.status === 'running') return <Badge variant="muted">running</Badge>
  return <Badge variant="success">ok</Badge>
}

export default function JobsAdminPage() {
  const toast = useToast()
  const [jobRuns, setJobRuns] = useState<JobRunRow[]>([])
  const [failedEmails, setFailedEmails] = useState<EmailJobRow[]>([])
  const [knownNames, setKnownNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [name, setName] = useState('')
  const [failedOnly, setFailedOnly] = useState(false)
  const [days, setDays] = useState('7')

  const load = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      setLoading(true)
      try {
        const qs = new URLSearchParams({ days })
        if (name) qs.set('name', name)
        if (failedOnly) qs.set('failedOnly', 'true')
        if (opts?.cursor) qs.set('cursor', opts.cursor)
        const res = await fetch(`/api/admin/jobs?${qs.toString()}`)
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
          toast.error(data.error || 'Failed to load jobs.')
          return
        }
        const data = await res.json()
        const runs = (data.jobRuns || []) as JobRunRow[]
        setJobRuns((prev) => (opts?.append ? [...prev, ...runs] : runs))
        if (!opts?.append) {
          setFailedEmails((data.failedEmailJobs || []) as EmailJobRow[])
          setKnownNames((data.knownJobNames || []) as string[])
        }
        setNextCursor(data.nextCursor || null)
      } catch {
        toast.error('Network error — please try again.')
      } finally {
        setLoading(false)
      }
    },
    [days, failedOnly, name, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  const failedEmailColumns = useMemo<DataColumn<EmailJobRow>[]>(
    () => [
      {
        id: 'kind',
        header: 'Kind',
        headerText: 'Kind',
        cell: (row) => row.kind,
        exportValue: (row) => row.kind,
      },
      {
        id: 'organizationId',
        header: 'Org',
        headerText: 'Org',
        cell: (row) => <span className="font-mono text-xs">{row.organizationId}</span>,
        exportValue: (row) => row.organizationId,
      },
      {
        id: 'lastError',
        header: 'Error',
        headerText: 'Error',
        cell: (row) => (
          <span className="max-w-md truncate text-fg-muted">{row.lastError || '—'}</span>
        ),
        exportValue: (row) => row.lastError || '',
      },
      {
        id: 'createdAt',
        header: 'When',
        headerText: 'When',
        cell: (row) => (
          <span className="whitespace-nowrap text-fg-muted">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        ),
        exportValue: (row) => new Date(row.createdAt),
      },
    ],
    [],
  )

  const jobRunColumns = useMemo<DataColumn<JobRunRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Job',
        headerText: 'Job',
        cell: (row) => <span className="font-mono text-xs">{row.name}</span>,
        exportValue: (row) => row.name,
      },
      {
        id: 'status',
        header: 'Status',
        headerText: 'Status',
        cell: (row) => statusBadge(row),
        exportValue: (row) => row.status,
      },
      {
        id: 'processed',
        header: 'Processed',
        headerText: 'Processed',
        align: 'right',
        cell: (row) => row.processed,
        exportValue: (row) => row.processed,
      },
      {
        id: 'failed',
        header: 'Failed',
        headerText: 'Failed',
        align: 'right',
        cell: (row) => row.failed,
        exportValue: (row) => row.failed,
      },
      {
        id: 'startedAt',
        header: 'Started',
        headerText: 'Started',
        cell: (row) => (
          <span className="whitespace-nowrap text-fg-muted">
            {new Date(row.startedAt).toLocaleString()}
          </span>
        ),
        exportValue: (row) => new Date(row.startedAt),
      },
      {
        id: 'error',
        header: 'Error',
        headerText: 'Error',
        cell: (row) => (
          <span className="max-w-xs truncate text-fg-muted">
            {row.lastError || (row.errorCount > 0 ? `${row.errorCount} errors` : '—')}
          </span>
        ),
        exportValue: (row) => row.lastError || (row.errorCount > 0 ? String(row.errorCount) : ''),
      },
    ],
    [],
  )

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Alert variant="danger" title="Access denied">
          Platform administrators only.
        </Alert>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <PageHeader
        title="Job health"
        subtitle="Cron batch runs and failed bulk email jobs. See docs/runbooks/cron-failure.md for triage."
        actions={
          <ButtonLink href="/admin" variant="secondary" size="sm">
            Admin hub
          </ButtonLink>
        }
      />

      {twoFactorRequired ? (
        <Alert variant="warning" title="Two-factor authentication required">
          <p>Enable 2FA in account settings to access platform admin tools.</p>
          <Link href="/account" className="mt-2 inline-flex text-sm font-medium text-accent">
            Account settings →
          </Link>
        </Alert>
      ) : (
        <>
          <Card className="p-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="min-w-[160px]">
              <Select label="Job name" value={name} onChange={(e) => setName(e.target.value)}>
                <option value="">All jobs</option>
                {knownNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[120px]">
              <Select label="Window" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">Last 24h</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-fg pb-2">
              <input
                type="checkbox"
                checked={failedOnly}
                onChange={(e) => setFailedOnly(e.target.checked)}
                className="rounded border-border"
              />
              Failed only
            </label>
            <Button type="button" onClick={() => load()}>
              Apply filters
            </Button>
          </Card>

          {failedEmails.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-fg mb-2">Failed email jobs</h2>
              <DataView
                tableId="admin-failed-email-jobs"
                rows={failedEmails}
                columns={failedEmailColumns}
                rowKey={(row) => row.id}
                toolbar={false}
                defaultSort={{ id: 'createdAt', dir: 'desc' }}
                mobileCard={(row) => (
                  <Card compact>
                    <p className="font-medium text-fg">{row.kind}</p>
                    <p className="text-xs font-mono text-fg-muted">{row.organizationId}</p>
                    <p className="mt-2 text-xs text-fg-muted">
                      {new Date(row.createdAt).toLocaleString()}
                    </p>
                    {row.lastError && <p className="mt-1 text-xs text-danger">{row.lastError}</p>}
                  </Card>
                )}
              />
            </section>
          )}

          <section>
            <h2 className="text-base font-semibold text-fg mb-2">Cron job runs</h2>
            {loading && jobRuns.length === 0 ? (
              <SkeletonRows count={6} />
            ) : jobRuns.length === 0 ? (
              <EmptyState
                title="No job runs"
                description="Try widening the time window or filters."
              />
            ) : (
              <DataView
                tableId="admin-cron-job-runs"
                rows={jobRuns}
                columns={jobRunColumns}
                rowKey={(row) => row.id}
                toolbar={false}
                defaultSort={{ id: 'startedAt', dir: 'desc' }}
                mobileCard={(row) => (
                  <Card compact>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs text-fg">{row.name}</p>
                        <p className="mt-1 text-xs text-fg-muted">
                          {new Date(row.startedAt).toLocaleString()}
                        </p>
                      </div>
                      {statusBadge(row)}
                    </div>
                    <p className="mt-2 text-sm tabular text-fg-muted">
                      Processed {row.processed} · Failed {row.failed}
                    </p>
                  </Card>
                )}
              />
            )}
          </section>

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="secondary"
                loading={loading}
                onClick={() => load({ cursor: nextCursor, append: true })}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
