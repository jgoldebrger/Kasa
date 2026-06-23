'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/app/components/Toast'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin-constants'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
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
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm text-left">
                  <thead className="bg-app-subtle border-b border-border">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Kind</th>
                      <th className="px-4 py-2 font-semibold">Org</th>
                      <th className="px-4 py-2 font-semibold">Error</th>
                      <th className="px-4 py-2 font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {failedEmails.map((j) => (
                      <tr key={j.id}>
                        <td className="px-4 py-2">{j.kind}</td>
                        <td className="px-4 py-2 font-mono text-xs">{j.organizationId}</td>
                        <td className="px-4 py-2 text-fg-muted max-w-md truncate">
                          {j.lastError || '—'}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                          {new Date(j.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm text-left">
                  <thead className="bg-app-subtle border-b border-border">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Job</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                      <th className="px-4 py-2 font-semibold">Processed</th>
                      <th className="px-4 py-2 font-semibold">Failed</th>
                      <th className="px-4 py-2 font-semibold">Started</th>
                      <th className="px-4 py-2 font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {jobRuns.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2 font-mono text-xs">{row.name}</td>
                        <td className="px-4 py-2">{statusBadge(row)}</td>
                        <td className="px-4 py-2">{row.processed}</td>
                        <td className="px-4 py-2">{row.failed}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                          {new Date(row.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-fg-muted max-w-xs truncate">
                          {row.lastError || (row.errorCount > 0 ? `${row.errorCount} errors` : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
