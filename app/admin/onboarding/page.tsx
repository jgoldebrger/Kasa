'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  SkeletonRows,
} from '@/app/components/ui'

type SetupProgress = {
  completed: number
  total: number
  requiredComplete: boolean
  complete: boolean
  steps: { id: string; done: boolean; optional: boolean }[]
}

type OrgRow = {
  id: string
  name: string
  slug: string
  planTier: string | null
  subscriptionStatus: string | null
  setupCompletedAt: string | null
  createdAt: string
  daysSinceCreated: number | null
  lastActivityAt: string | null
  familyCount: number
  owner: { id: string; name: string; email: string } | null
  setupProgress?: SetupProgress
}

const STEP_LABELS: Record<string, string> = {
  paymentPlans: 'Plans',
  eventTypes: 'Events',
  email: 'Email',
  cycle: 'Cycle',
  stripeConnect: 'Stripe',
  firstFamily: 'Family',
  firstPayment: 'Payment',
}

function subscriptionBadge(status: string | null) {
  if (!status) return <Badge variant="muted">no sub</Badge>
  if (status === 'active' || status === 'trialing') {
    return <Badge variant="success">{status}</Badge>
  }
  return <Badge variant="warning">{status}</Badge>
}

export default function OnboardingAdminPage() {
  const router = useRouter()
  const toast = useToast()
  const [rows, setRows] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)

  const load = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      setLoading(true)
      try {
        const qs = new URLSearchParams({
          stuck: 'true',
          includeProgress: 'true',
        })
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
    [toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function enterAsAdmin(org: OrgRow) {
    setEnteringId(org.id)
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}/impersonate`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not enter support mode.')
        return
      }
      toast.success(`Now viewing ${org.name} as admin.`)
      router.push(data.redirectTo || '/')
      router.refresh()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setEnteringId(null)
    }
  }

  async function markSetupComplete(org: OrgRow) {
    setMarkingId(org.id)
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}/mark-setup-complete`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not mark setup complete.')
        return
      }
      toast.success(`Marked ${org.name} setup complete.`)
      void load()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setMarkingId(null)
    }
  }

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
        title="Onboarding"
        subtitle="Workspaces that have not finished setup. Review progress and help stuck treasurers."
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
      ) : loading && rows.length === 0 ? (
        <SkeletonRows count={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No stuck workspaces"
          description="Every organization has completed setup, or none match the filter."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((org) => (
            <Card key={org.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-fg">{org.name}</div>
                  <div className="text-xs text-fg-muted font-mono">{org.slug}</div>
                  {org.owner && (
                    <div className="text-sm text-fg-muted mt-1">
                      {org.owner.name} · {org.owner.email}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {subscriptionBadge(org.subscriptionStatus)}
                  {org.daysSinceCreated != null && (
                    <Badge variant="muted">{org.daysSinceCreated}d old</Badge>
                  )}
                </div>
              </div>

              {org.setupProgress && (
                <div className="flex flex-wrap gap-2">
                  {org.setupProgress.steps.map((step) => (
                    <Badge
                      key={step.id}
                      variant={step.done ? 'success' : step.optional ? 'muted' : 'warning'}
                    >
                      {STEP_LABELS[step.id] || step.id}
                      {step.optional ? ' (opt)' : ''}
                    </Badge>
                  ))}
                  <span className="text-xs text-fg-muted self-center">
                    {org.setupProgress.completed}/{org.setupProgress.total} steps
                  </span>
                </div>
              )}

              {org.lastActivityAt && (
                <p className="text-xs text-fg-subtle">
                  Last activity {new Date(org.lastActivityAt).toLocaleString()}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={enteringId === org.id}
                  onClick={() => enterAsAdmin(org)}
                >
                  Open as admin
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={markingId === org.id}
                  onClick={() => markSetupComplete(org)}
                >
                  Mark setup complete
                </Button>
              </div>
            </Card>
          ))}
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
    </div>
  )
}
