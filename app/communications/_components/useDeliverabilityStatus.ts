'use client'

import { useCallback, useEffect, useState } from 'react'

export type DeliverabilityCheckStatus = 'pass' | 'warn' | 'fail'

export interface DeliverabilityCheck {
  status: DeliverabilityCheckStatus
  ok: boolean
}

export interface DeliverabilityStatus {
  smtpConfigured: DeliverabilityCheck
  smtpVerifiedRecently: DeliverabilityCheck
  replyToSet: DeliverabilityCheck
  physicalAddressSet: DeliverabilityCheck
  quotaHeadroom: DeliverabilityCheck
  quota: { sentToday: number; limit: number; remaining: number }
  emailStrictDeliverability?: boolean
}

const CHECK_IDS = [
  'smtpConfigured',
  'smtpVerifiedRecently',
  'replyToSet',
  'physicalAddressSet',
  'quotaHeadroom',
] as const

export function hasDeliverabilityFailures(status: DeliverabilityStatus | null): boolean {
  if (!status) return false
  return CHECK_IDS.some((id) => status[id].status === 'fail')
}

export function useDeliverabilityStatus() {
  const [status, setStatus] = useState<DeliverabilityStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/emails/deliverability-status')
      if (!res.ok) {
        setStatus(null)
        return
      }
      setStatus((await res.json()) as DeliverabilityStatus)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    status,
    loading,
    hasFailures: hasDeliverabilityFailures(status),
    strictMode: !!status?.emailStrictDeliverability,
    refresh,
  }
}
