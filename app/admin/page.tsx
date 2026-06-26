'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/app/components/Toast'
import { notifySupportModeChanged } from '@/lib/client/support-mode'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin-constants'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  PageHeader,
  SkeletonRows,
} from '@/app/components/ui'

interface ImpersonationState {
  active: boolean
  organizationName?: string | null
}

const ADMIN_LINKS = [
  {
    href: '/admin/invite-requests',
    title: 'Invite requests',
    description: 'Review and approve early-access signup requests.',
  },
  {
    href: '/admin/organizations',
    title: 'Organizations',
    description: 'Search all workspaces, view billing status, and enter support mode.',
  },
  {
    href: '/admin/onboarding',
    title: 'Onboarding',
    description: 'Tenants stuck in setup — progress flags and quick actions.',
  },
  {
    href: '/admin/jobs',
    title: 'Job health',
    description: 'Cron batch runs and failed bulk email jobs.',
  },
] as const

const RUNBOOK_PATHS = [
  'docs/runbooks/deploy-rollback.md',
  'docs/runbooks/cron-failure.md',
  'docs/runbooks/db-restore.md',
  'docs/runbooks/stripe-webhook-replay.md',
  'docs/runbooks/uptime-monitoring.md',
] as const

export default function AdminHubPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null)
  const [exiting, setExiting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setTwoFactorRequired(false)
    setForbidden(false)
    try {
      const res = await fetch('/api/admin/impersonate')
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}))
        if (data?.code === PLATFORM_ADMIN_2FA_REQUIRED_CODE) {
          setTwoFactorRequired(true)
          return
        }
        setForbidden(true)
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setImpersonation({
        active: Boolean(data.active),
        organizationName: data.organizationName,
      })
    } catch {
      toast.error('Could not load admin status.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function exitSupportMode() {
    setExiting(true)
    try {
      const res = await fetch('/api/admin/impersonate', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Could not exit support mode.')
        return
      }
      toast.success('Exited support mode.')
      notifySupportModeChanged({ active: false })
      await load()
      router.refresh()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setExiting(false)
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
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <PageHeader
        title="Platform admin"
        subtitle="Operations console for Kasa staff. All support actions are audit-logged."
      />

      {loading ? (
        <SkeletonRows count={4} />
      ) : twoFactorRequired ? (
        <Alert variant="warning" title="Two-factor authentication required">
          <p>
            Platform admin access requires 2FA on your account. Enable it in account settings, then
            return here.
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
          {impersonation?.active && (
            <Alert variant="warning" title="Support mode active">
              <p className="mb-3">
                You are viewing{' '}
                <strong>{impersonation.organizationName || 'an organization'}</strong> as admin.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={exiting}
                onClick={exitSupportMode}
              >
                Exit support mode
              </Button>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {ADMIN_LINKS.map((link) => (
              <Card key={link.href} className="p-5 flex flex-col gap-2">
                <h2 className="font-semibold text-fg">{link.title}</h2>
                <p className="text-sm text-fg-muted flex-1">{link.description}</p>
                <ButtonLink href={link.href} size="sm" className="self-start">
                  Open
                </ButtonLink>
              </Card>
            ))}
          </div>

          <section>
            <h2 className="text-lg font-semibold text-fg mb-3">System status</h2>
            <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-fg-muted">
                  Public status page for uptime monitors and treasurers.
                </p>
                <Badge variant="muted" className="mt-2">
                  Probe: GET /api/health
                </Badge>
              </div>
              <ButtonLink href="/status" variant="secondary" size="sm" target="_blank">
                View /status
              </ButtonLink>
            </Card>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-fg mb-3">Runbooks</h2>
            <ul className="text-sm text-fg-muted space-y-1 list-disc pl-5">
              {RUNBOOK_PATHS.map((path) => (
                <li key={path}>
                  <code className="text-xs">{path}</code>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
