'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/app/components/Toast'
import type { PlanTier } from '@/lib/billing/plans'

interface PricingActionsProps {
  tier: PlanTier
  isSignedIn: boolean
}

export default function PricingActions({ tier, isSignedIn }: PricingActionsProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  if (tier === 'institution') {
    return (
      <a
        href="mailto:support@kasa.com?subject=Kasa%20Institution%20plan"
        className="focus-ring w-full text-center rounded-md border border-border px-4 py-2.5 text-sm font-medium text-fg hover:bg-fg/5"
      >
        Contact sales
      </a>
    )
  }

  if (!isSignedIn) {
    return (
      <Link
        href="/login"
        className="focus-ring w-full text-center rounded-md bg-accent text-accent-fg px-4 py-2.5 text-sm font-medium hover:bg-accent-hover"
      >
        Sign in to subscribe
      </Link>
    )
  }

  const startCheckout = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: tier }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not start checkout.')
        return
      }
      if (body.url) {
        window.location.href = body.url
      }
    } catch {
      toast.error('Could not start checkout.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void startCheckout()}
      disabled={loading}
      className="focus-ring w-full rounded-md bg-accent text-accent-fg px-4 py-2.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-60"
    >
      {loading ? 'Redirecting…' : 'Subscribe'}
    </button>
  )
}
