'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BanknotesIcon } from '@heroicons/react/24/outline'
import { Button, SkeletonRows } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import type { ConnectStatusPayload } from '@/lib/route-logic/stripe/connect/status'

interface StripeConnectPanelProps {
  canManage: boolean
  isOwner: boolean
}

function statusLabel(status: ConnectStatusPayload['stripeConnectOnboardingStatus']): string {
  switch (status) {
    case 'not_started':
      return 'Not started'
    case 'pending':
      return 'Onboarding in progress'
    case 'complete':
      return 'Connected'
    case 'restricted':
      return 'Action required'
    default:
      return status
  }
}

export default function StripeConnectPanel({ canManage, isOwner }: StripeConnectPanelProps) {
  const toast = useToast()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<ConnectStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/connect/status')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not load payout account status.')
        return
      }
      setStatus(body as ConnectStatusPayload)
    } catch {
      toast.error('Could not load payout account status.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useOrgChanged(refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const connectParam = searchParams.get('connect')
    if (connectParam === 'return' || connectParam === 'refresh') {
      toast.success('Checking your Stripe Connect status…')
      void refresh()
    }
  }, [searchParams, toast, refresh])

  const startOnboarding = useCallback(async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/stripe/connect/onboard', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not start Stripe Connect onboarding.')
        return
      }
      if (body.url) {
        window.location.href = body.url
      }
    } catch {
      toast.error('Could not start Stripe Connect onboarding.')
    } finally {
      setActionLoading(false)
    }
  }, [toast])

  const openDashboard = useCallback(async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/stripe/connect/dashboard', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not open Stripe dashboard.')
        return
      }
      if (body.url) {
        window.location.href = body.url
      }
    } catch {
      toast.error('Could not open Stripe dashboard.')
    } finally {
      setActionLoading(false)
    }
  }, [toast])

  if (loading) {
    return <SkeletonRows count={3} />
  }

  if (!status?.connectEnabled) {
    return null
  }

  const onboardingStatus = status.stripeConnectOnboardingStatus
  const requirements = status.requirements
  const dueItems = [...(requirements?.pastDue ?? []), ...(requirements?.currentlyDue ?? [])]

  return (
    <div className="surface-card p-6">
      <div className="flex items-start gap-3 mb-4">
        <BanknotesIcon className="h-6 w-6 text-fg-muted shrink-0" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-fg">Member dues payouts</h2>
          <p className="text-sm text-fg-muted mt-1">
            Connect a Stripe account so member card payments settle directly to your organization.
            Your Kasa platform subscription is billed separately above.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <dt className="text-fg-muted">Status</dt>
          <dd className="font-medium text-fg">{statusLabel(onboardingStatus)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Charges</dt>
          <dd className="font-medium text-fg">
            {status.stripeConnectChargesEnabled ? 'Enabled' : 'Not enabled'}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Payouts</dt>
          <dd className="font-medium text-fg">
            {status.stripeConnectPayoutsEnabled ? 'Enabled' : 'Not enabled'}
          </dd>
        </div>
        {status.stripeConnectAccountId && (
          <div>
            <dt className="text-fg-muted">Account</dt>
            <dd className="font-mono text-xs text-fg truncate">{status.stripeConnectAccountId}</dd>
          </div>
        )}
      </dl>

      {onboardingStatus === 'restricted' && dueItems.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium text-fg mb-1">Stripe needs additional information</p>
          <ul className="list-disc ps-5 text-fg-muted space-y-0.5">
            {dueItems.slice(0, 6).map((item) => (
              <li key={item}>{item.replace(/_/g, ' ')}</li>
            ))}
          </ul>
          {requirements?.disabledReason && (
            <p className="mt-2 text-fg-muted">Reason: {requirements.disabledReason}</p>
          )}
        </div>
      )}

      {canManage && isOwner && (
        <div className="flex flex-wrap gap-3">
          {(onboardingStatus === 'not_started' || !status.stripeConnectAccountId) && (
            <Button type="button" onClick={() => void startOnboarding()} disabled={actionLoading}>
              {actionLoading ? 'Redirecting…' : 'Connect with Stripe'}
            </Button>
          )}
          {(onboardingStatus === 'pending' || onboardingStatus === 'restricted') && (
            <Button type="button" onClick={() => void startOnboarding()} disabled={actionLoading}>
              {actionLoading ? 'Redirecting…' : 'Continue onboarding'}
            </Button>
          )}
          {onboardingStatus === 'complete' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void openDashboard()}
              disabled={actionLoading}
            >
              {actionLoading ? 'Opening…' : 'Open Stripe dashboard'}
            </Button>
          )}
        </div>
      )}

      {canManage && !isOwner && (
        <p className="text-sm text-fg-muted">
          Only the organization owner can connect or manage the payout account.
        </p>
      )}
    </div>
  )
}
