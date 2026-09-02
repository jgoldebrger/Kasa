'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useToast } from '@/app/components/Toast'
import SupportModeEnterModal from '@/app/components/SupportModeEnterModal'
import PlatformAdminTotpModal from '@/app/components/PlatformAdminTotpModal'
import SupportModeOpenButton from '@/app/components/SupportModeOpenButton'
import { enterSupportMode } from '@/lib/client/support-mode'
import { usePlatformAdminTotpGate } from '@/lib/client/usePlatformAdminTotpGate'
import type { SupportModeRedirect } from '@/lib/support-mode-redirect'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin-constants'
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
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'

type OrgRow = {
  id: string
  name: string
  slug: string
  planTier: string | null
  subscriptionStatus: string | null
  setupCompletedAt: string | null
  createdAt: string
  familyCount: number
  owner: { id: string; name: string; email: string } | null
}

function planBadge(tier: string | null) {
  if (!tier) return <Badge variant="muted">none</Badge>
  return <Badge variant="default">{tier}</Badge>
}

function statusBadge(status: string | null) {
  if (!status) return <Badge variant="muted">—</Badge>
  if (status === 'active' || status === 'trialing') {
    return <Badge variant="success">{status}</Badge>
  }
  return <Badge variant="warning">{status}</Badge>
}

function setupBadge(setupCompletedAt: string | null) {
  if (setupCompletedAt) {
    return <Badge variant="success">complete</Badge>
  }
  return <Badge variant="warning">in progress</Badge>
}

export default function OrganizationsAdminPage() {
  const router = useRouter()
  const toast = useToast()
  const { update: updateSession } = useSession()
  const [rows, setRows] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [modalOrg, setModalOrg] = useState<OrgRow | null>(null)
  const [modalRedirectTo, setModalRedirectTo] = useState<SupportModeRedirect>('/')
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const totpGate = usePlatformAdminTotpGate()

  const load = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean; q?: string }) => {
      setLoading(true)
      setTwoFactorRequired(false)
      try {
        const qs = new URLSearchParams()
        const q = opts?.q ?? search
        if (q) qs.set('q', q)
        if (opts?.cursor) qs.set('cursor', opts.cursor)
        const res = await fetch(`/api/admin/organizations?${qs.toString()}`)
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
          toast.error(data.error || 'Failed to load organizations.')
          return
        }
        const data = await res.json()
        const list = (data.organizations || []) as OrgRow[]
        setRows((prev) => (opts?.append ? [...prev, ...list] : list))
        setNextCursor(data.nextCursor || null)
      } catch {
        toast.error('Network error — please try again.')
      } finally {
        setLoading(false)
      }
    },
    [search, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function postImpersonate(
    orgId: string,
    payload: {
      reason: string
      readOnly: boolean
      scope: import('@/lib/support-mode-scope').SupportModeScope
    },
  ) {
    return fetch(`/api/admin/organizations/${orgId}/impersonate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, redirectTo: modalRedirectTo }),
    })
  }

  async function confirmEnterSupportMode({
    reason,
    readOnly,
    scope,
  }: {
    reason: string
    readOnly: boolean
    scope: import('@/lib/support-mode-scope').SupportModeScope
  }) {
    if (!modalOrg) return
    const org = modalOrg
    setEnteringId(org.id)
    try {
      const result = await totpGate.runWithTotpGate(
        { orgId: org.id, reason, readOnly, scope, redirectTo: modalRedirectTo },
        (entry) => postImpersonate(entry.orgId, entry),
      )
      if (!result.ok) {
        if (result.error) toast.error(result.error)
        return
      }
      const data = result.data
      toast.success(`Now viewing ${org.name} as admin.`)
      setModalOrg(null)
      await enterSupportMode({
        organizationId: data.organizationId || org.id,
        organizationName: data.organizationName || org.name,
        organizationSlug: data.organizationSlug || org.slug,
        readOnly: Boolean(data.readOnly ?? readOnly),
        scope: data.scope === 'communications' || data.scope === 'billing' ? data.scope : scope,
        expiresAt: data.expiresAt ?? null,
        redirectTo: data.redirectTo || '/',
        router,
        updateSession,
      })
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setEnteringId(null)
    }
  }

  async function handleTotpVerified() {
    if (!modalOrg) return
    const org = modalOrg
    setEnteringId(org.id)
    try {
      const result = await totpGate.retryAfterTotpVerified((entry) =>
        postImpersonate(entry.orgId, entry),
      )
      if (!result.ok) {
        toast.error(result.error || 'Could not enter support mode.')
        return
      }
      const data = result.data
      toast.success(`Now viewing ${org.name} as admin.`)
      setModalOrg(null)
      await enterSupportMode({
        organizationId: data.organizationId || org.id,
        organizationName: data.organizationName || org.name,
        organizationSlug: data.organizationSlug || org.slug,
        readOnly: Boolean(data.readOnly),
        scope: data.scope === 'communications' || data.scope === 'billing' ? data.scope : 'full',
        expiresAt: data.expiresAt ?? null,
        redirectTo: data.redirectTo || '/',
        router,
        updateSession,
      })
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setEnteringId(null)
    }
  }

  const orgColumns = useMemo<DataColumn<OrgRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Organization',
        headerText: 'Organization',
        cell: (org) => (
          <>
            <div className="font-medium text-fg">{org.name}</div>
            <div className="text-xs text-fg-muted font-mono">{org.slug}</div>
          </>
        ),
        exportValue: (org) => org.name,
      },
      {
        id: 'owner',
        header: 'Owner',
        headerText: 'Owner',
        cell: (org) =>
          org.owner ? (
            <>
              <div>{org.owner.name || '—'}</div>
              <div className="text-xs">{org.owner.email}</div>
            </>
          ) : (
            '—'
          ),
        exportValue: (org) => org.owner?.email || org.owner?.name || '',
      },
      {
        id: 'familyCount',
        header: 'Families',
        headerText: 'Families',
        align: 'right',
        cell: (org) => <span className="text-fg-muted">{org.familyCount}</span>,
        exportValue: (org) => org.familyCount,
      },
      {
        id: 'setup',
        header: 'Setup',
        headerText: 'Setup',
        cell: (org) => setupBadge(org.setupCompletedAt),
        exportValue: (org) => (org.setupCompletedAt ? 'complete' : 'in progress'),
      },
      {
        id: 'plan',
        header: 'Plan',
        headerText: 'Plan',
        cell: (org) => planBadge(org.planTier),
        exportValue: (org) => org.planTier || '',
      },
      {
        id: 'subscription',
        header: 'Subscription',
        headerText: 'Subscription',
        cell: (org) => statusBadge(org.subscriptionStatus),
        exportValue: (org) => org.subscriptionStatus || '',
      },
      {
        id: 'createdAt',
        header: 'Created',
        headerText: 'Created',
        cell: (org) => (
          <span className="whitespace-nowrap text-fg-muted">
            {org.createdAt ? new Date(org.createdAt).toLocaleDateString() : '—'}
          </span>
        ),
        exportValue: (org) => (org.createdAt ? new Date(org.createdAt) : ''),
      },
      {
        id: 'actions',
        header: <span className="sr-only">Actions</span>,
        headerText: 'Actions',
        align: 'right',
        sortable: false,
        cell: (org) => (
          <SupportModeOpenButton
            loading={enteringId === org.id}
            onSelect={(redirectTo) => {
              setModalRedirectTo(redirectTo)
              setModalOrg(org)
            }}
          />
        ),
        exportValue: () => '',
      },
    ],
    [enteringId],
  )

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
        title="Organizations"
        subtitle="All Kasa workspaces. Open a tenant in support mode to troubleshoot as an org admin."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/admin" variant="secondary" size="sm">
              Admin hub
            </ButtonLink>
            <ButtonLink href="/admin/onboarding" variant="secondary" size="sm">
              Stuck onboarding
            </ButtonLink>
          </div>
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
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(query.trim())
                void load({ q: query.trim() })
              }}
            >
              <div className="flex-1">
                <Input
                  label="Search"
                  type="search"
                  placeholder="Name or slug…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
          </Card>

          {loading && rows.length === 0 ? (
            <SkeletonRows count={6} />
          ) : rows.length === 0 ? (
            <EmptyState title="No organizations found" description="Try a different search term." />
          ) : (
            <DataView
              tableId="admin-organizations"
              rows={rows}
              columns={orgColumns}
              rowKey={(org) => org.id}
              defaultSort={{ id: 'createdAt', dir: 'desc' }}
              mobileCard={(org) => (
                <Card compact>
                  <p className="font-medium text-fg">{org.name}</p>
                  <p className="text-xs font-mono text-fg-muted">{org.slug}</p>
                  <p className="mt-2 text-sm text-fg-muted">
                    {org.owner?.name || org.owner?.email || 'No owner'} · {org.familyCount} families
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {setupBadge(org.setupCompletedAt)}
                    {planBadge(org.planTier)}
                    {statusBadge(org.subscriptionStatus)}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <SupportModeOpenButton
                      loading={enteringId === org.id}
                      onSelect={(redirectTo) => {
                        setModalRedirectTo(redirectTo)
                        setModalOrg(org)
                      }}
                    />
                  </div>
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
                Load more
              </Button>
            </div>
          )}

          <p className="text-xs text-fg-muted">
            Support mode grants org <strong>admin</strong> access without changing the
            customer&apos;s data ownership. All entries are audit-logged. Exit from the banner at
            the top of the app.
          </p>

          <SupportModeEnterModal
            open={modalOrg !== null}
            organizationName={modalOrg?.name || ''}
            confirming={enteringId !== null}
            onClose={() => {
              if (enteringId === null) setModalOrg(null)
            }}
            onConfirm={confirmEnterSupportMode}
          />

          <PlatformAdminTotpModal
            open={totpGate.totpOpen}
            onClose={() => {
              if (enteringId === null) totpGate.clearPending()
            }}
            onVerified={handleTotpVerified}
          />
        </>
      )}
    </div>
  )
}
