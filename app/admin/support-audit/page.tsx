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
  Input,
  PageHeader,
  Select,
  SkeletonRows,
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
}

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
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)

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
          toast.error(data.error || 'Failed to load support audit log.')
          return
        }
        const data = await res.json()
        const raw = (data.entries || data.auditEntries || []) as Array<{
          id: string
          createdAt: string
          action: string
          reason?: string | null
          readOnly?: boolean | null
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
        }))
        setRows((prev) => (opts?.append ? [...prev, ...list] : list))
        setNextCursor(data.nextCursor || null)
      } catch {
        toast.error('Network error — please try again.')
      } finally {
        setLoading(false)
      }
    },
    [filters, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

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

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Alert variant="danger" title="Access denied">
          This page is only available to platform administrators listed in{' '}
          <code className="text-xs">PLATFORM_ADMIN_EMAILS</code>.
        </Alert>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <PageHeader
        title="Support audit"
        subtitle="Impersonation sessions started and ended by platform admins. All entries include the stated reason."
        actions={
          <ButtonLink href="/admin" variant="secondary" size="sm">
            Admin hub
          </ButtonLink>
        }
      />

      {twoFactorRequired ? (
        <Alert variant="warning" title="Two-factor authentication required">
          <p>
            Platform admin access requires 2FA on your account. Enable it in account settings, then
            return to this page.
          </p>
          <Link
            href="/account"
            className="mt-2 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
          >
            Go to account settings →
          </Link>
        </Alert>
      ) : (
        <>
          <Card className="p-4">
            <form
              className="flex flex-col gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-5 sm:items-end"
              onSubmit={applyFilters}
            >
              <Select
                label="Action"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
              >
                <option value="">All actions</option>
                <option value="start">Start</option>
                <option value="end">End</option>
              </Select>
              <Input
                label="Organization"
                type="search"
                placeholder="Name or slug…"
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
              />
              <Input
                label="From"
                type="date"
                value={fromDateInput}
                onChange={(e) => setFromDateInput(e.target.value)}
              />
              <Input
                label="To"
                type="date"
                value={toDateInput}
                onChange={(e) => setToDateInput(e.target.value)}
              />
              <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
                <Button type="submit">Search</Button>
                <Button type="button" variant="secondary" onClick={exportCsv}>
                  Export CSV
                </Button>
              </div>
            </form>
          </Card>

          {loading && rows.length === 0 ? (
            <SkeletonRows count={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No impersonation entries"
              description="Adjust the filters above or clear them to see support session history."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-app-subtle border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Admin</th>
                    <th className="px-4 py-3 font-semibold">Organization</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Reason</th>
                    <th className="px-4 py-3 font-semibold">Read-only</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="bg-surface">
                      <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                        {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        <div>{row.userName || row.userId}</div>
                        {row.userEmail && <div className="text-xs">{row.userEmail}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg">{row.organizationName || '—'}</div>
                        {row.organizationSlug && (
                          <div className="text-xs text-fg-muted font-mono">
                            {row.organizationSlug}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{actionBadge(row.action)}</td>
                      <td className="px-4 py-3 text-fg-muted max-w-xs">
                        {row.reason || (row.action === 'platform.impersonate.start' ? '—' : '')}
                      </td>
                      <td className="px-4 py-3">
                        {row.action === 'platform.impersonate.start' ? (
                          row.readOnly ? (
                            <Badge variant="warning">Yes</Badge>
                          ) : (
                            <Badge variant="muted">No</Badge>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
