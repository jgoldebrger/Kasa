'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useToast } from '@/app/components/Toast'
import SupportModeEnterModal from '@/app/components/SupportModeEnterModal'
import { enterSupportMode } from '@/lib/client/support-mode'
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
  SkeletonRows,
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
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)

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

  async function confirmEnterSupportMode({
    reason,
    readOnly,
  }: {
    reason: string
    readOnly: boolean
  }) {
    if (!modalOrg) return
    const org = modalOrg
    setEnteringId(org.id)
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, readOnly }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not enter support mode.')
        return
      }
      toast.success(`Now viewing ${org.name} as admin.`)
      setModalOrg(null)
      await enterSupportMode({
        organizationId: data.organizationId || org.id,
        organizationName: data.organizationName || org.name,
        organizationSlug: data.organizationSlug || org.slug,
        readOnly: Boolean(data.readOnly ?? readOnly),
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
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-app-subtle border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Organization</th>
                    <th className="px-4 py-3 font-semibold">Owner</th>
                    <th className="px-4 py-3 font-semibold">Families</th>
                    <th className="px-4 py-3 font-semibold">Setup</th>
                    <th className="px-4 py-3 font-semibold">Plan</th>
                    <th className="px-4 py-3 font-semibold">Subscription</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((org) => (
                    <tr key={org.id} className="bg-surface">
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg">{org.name}</div>
                        <div className="text-xs text-fg-muted font-mono">{org.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {org.owner ? (
                          <>
                            <div>{org.owner.name || '—'}</div>
                            <div className="text-xs">{org.owner.email}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">{org.familyCount}</td>
                      <td className="px-4 py-3">{setupBadge(org.setupCompletedAt)}</td>
                      <td className="px-4 py-3">{planBadge(org.planTier)}</td>
                      <td className="px-4 py-3">{statusBadge(org.subscriptionStatus)}</td>
                      <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                        {org.createdAt ? new Date(org.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          loading={enteringId === org.id}
                          onClick={() => setModalOrg(org)}
                        >
                          Open as admin
                        </Button>
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
        </>
      )}
    </div>
  )
}
