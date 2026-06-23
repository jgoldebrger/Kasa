'use client'

import { useState } from 'react'
import { Button, ButtonLink } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { useOrgRole } from '@/lib/client/useOrgRole'
import { useT } from '@/lib/client/i18n'
import type { PlanTier } from '@/lib/billing/plans'

interface PricingActionsProps {
  tier: PlanTier
  isSignedIn: boolean
}

export default function PricingActions({ tier, isSignedIn }: PricingActionsProps) {
  const toast = useToast()
  const t = useT()
  const { role, loading: roleLoading } = useOrgRole()
  const [loading, setLoading] = useState(false)

  if (tier === 'institution') {
    return (
      <ButtonLink
        href="mailto:support@kasa.com?subject=Kasa%20Institution%20plan"
        variant="secondary"
        block
      >
        {t('pricing.contactSales')}
      </ButtonLink>
    )
  }

  if (!isSignedIn) {
    return (
      <ButtonLink href="/login" block>
        {t('pricing.signInToSubscribe')}
      </ButtonLink>
    )
  }

  if (!roleLoading && role && role !== 'owner') {
    return <p className="text-sm text-fg-muted text-center">{t('pricing.ownerOnly')}</p>
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
        toast.error(body.error || t('pricing.checkoutFailed'))
        return
      }
      if (body.url) {
        window.location.href = body.url
      }
    } catch {
      toast.error(t('pricing.checkoutFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      onClick={() => void startCheckout()}
      loading={loading || roleLoading}
      block
      size="lg"
    >
      {loading ? t('pricing.redirecting') : t('pricing.subscribe')}
    </Button>
  )
}
