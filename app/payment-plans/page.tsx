'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Backwards-compat redirect — the payment-plans UI now lives as a tab
 * inside `/settings`. Old bookmarks / nav links bounce here and forward
 * straight to the consolidated settings page so we have a single source
 * of truth for plan management.
 */
export default function PaymentPlansRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=paymentPlans')
  }, [router])
  return (
    <div className="p-6 text-sm text-fg-muted">Redirecting to Settings…</div>
  )
}
