'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CreditCardIcon } from '@heroicons/react/24/outline'
import { Button, SkeletonRows } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useBillingCheckoutReturn } from '@/lib/client/useBillingCheckoutReturn'
import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import StripeConnectPanel from '@/app/components/settings/StripeConnectPanel'

export interface BillingSnapshot {
  planTier?: string | null
  subscriptionStatus?: string | null
  trialEndsAt?: string | null
  currentPeriodEnd?: string | null
  stripeCustomerId?: string | null
}

interface BillingPanelProps {
  canManage: boolean
  isOwner: boolean
  initialBilling?: BillingSnapshot | null
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return 'Not subscribed'
  return status.replace(/_/g, ' ')
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

export default function BillingPanel({
  canManage,
  isOwner,
  initialBilling = null,
}: BillingPanelProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [billing, setBilling] = useState<BillingSnapshot | null>(initialBilling)
  const [loading, setLoading] = useState(!initialBilling)
  const [portalLoading, setPortalLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/organizations/current')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastRef.current.error(body.error || 'Could not load billing status.')
        return
      }
      setBilling({
        planTier: body.planTier ?? null,
        subscriptionStatus: body.subscriptionStatus ?? null,
        trialEndsAt: body.trialEndsAt ?? null,
        currentPeriodEnd: body.currentPeriodEnd ?? null,
        stripeCustomerId: body.stripeCustomerId ?? null,
      })
    } catch {
      toastRef.current.error('Could not load billing status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useOrgChanged(refresh)

  useEffect(() => {
    if (!initialBilling) void refresh()
  }, [initialBilling, refresh])

  useBillingCheckoutReturn(refresh)

  const syncFromStripe = useCallback(async () => {
    setSyncLoading(true)
    try {
      const res = await fetch('/api/billing/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastRef.current.error(body.error || 'Could not sync subscription from Stripe.')
        return
      }
      toastRef.current.success('Billing status updated.')
      await refresh()
    } catch {
      toastRef.current.error('Could not sync subscription from Stripe.')
    } finally {
      setSyncLoading(false)
    }
  }, [refresh])

  const openPortal = useCallback(async () => {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastRef.current.error(body.error || 'Could not open billing portal.')
        return
      }
      if (body.url) {
        window.location.href = body.url
      }
    } catch {
      toastRef.current.error('Could not open billing portal.')
    } finally {
      setPortalLoading(false)
    }
  }, [])

  const planName = PLAN_DEFINITIONS.find((p) => p.tier === billing?.planTier)?.name ?? 'None'

  if (loading) {
    return <SkeletonRows count={4} />
  }

  return (
    <div className="space-y-6">
      <div className="surface-card p-6">
        <div className="flex items-start gap-3 mb-4">
          <CreditCardIcon className="h-6 w-6 text-fg-muted shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-fg">Platform subscription</h2>
            <p className="text-sm text-fg-muted mt-1">
              Your Kasa workspace subscription is billed separately from member dues.
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-fg-muted">Plan</dt>
            <dd className="font-medium text-fg capitalize">{planName}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Status</dt>
            <dd className="font-medium text-fg capitalize">
              {formatStatus(billing?.subscriptionStatus)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Trial ends</dt>
            <dd className="font-medium text-fg">{formatDate(billing?.trialEndsAt)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Current period ends</dt>
            <dd className="font-medium text-fg">{formatDate(billing?.currentPeriodEnd)}</dd>
          </div>
        </dl>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-3">
          <Link
            href="/pricing"
            className="focus-ring inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-fg/5"
          >
            View plans
          </Link>
          {isOwner && billing?.stripeCustomerId && (
            <Button type="button" onClick={() => void openPortal()} disabled={portalLoading}>
              {portalLoading ? 'Opening…' : 'Manage in Stripe'}
            </Button>
          )}
          {isOwner &&
            billing?.stripeCustomerId &&
            billing?.subscriptionStatus !== 'active' &&
            billing?.subscriptionStatus !== 'trialing' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void syncFromStripe()}
                disabled={syncLoading}
              >
                {syncLoading ? 'Syncing…' : 'Refresh status'}
              </Button>
            )}
          {isOwner && !billing?.stripeCustomerId && (
            <Link
              href="/pricing"
              className="focus-ring inline-flex items-center justify-center rounded-md bg-accent text-accent-fg px-4 py-2 text-sm font-medium hover:bg-accent-hover"
            >
              {billing?.subscriptionStatus === 'trialing' ? 'View plans' : 'Subscribe'}
            </Link>
          )}
        </div>
      )}

      {!isOwner && canManage && (
        <p className="text-sm text-fg-muted">
          Only the organization owner can start or change the platform subscription.
        </p>
      )}

      <StripeConnectPanel canManage={canManage} isOwner={isOwner} />
    </div>
  )
}
