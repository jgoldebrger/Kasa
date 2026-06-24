'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/app/components/Toast'

/**
 * After Stripe Checkout success, sync subscription state and strip
 * `checkout` / `session_id` from the URL.
 */
export function useBillingCheckoutReturn(onSynced?: () => void | Promise<void>) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const onSyncedRef = useRef(onSynced)
  onSyncedRef.current = onSynced
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const handledRef = useRef(false)

  useEffect(() => {
    if (searchParams.get('checkout') !== 'success') return
    if (handledRef.current) return
    handledRef.current = true

    const sessionId = searchParams.get('session_id')

    const syncAndRefresh = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch('/api/billing/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionId ? { sessionId } : {}),
          })
          if (res.ok) {
            toastRef.current.success('Subscription active. Welcome to Kasa!')
            await onSyncedRef.current?.()
            return
          }
        } catch {
          // retry below
        }
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
      }
      toastRef.current.success('Payment received. Refreshing billing status…')
      await onSyncedRef.current?.()
    }

    void syncAndRefresh()

    const params = new URLSearchParams(searchParams.toString())
    params.delete('checkout')
    params.delete('session_id')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, pathname, router])
}
