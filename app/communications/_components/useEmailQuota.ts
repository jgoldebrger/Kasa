'use client'

import { useCallback, useEffect, useState } from 'react'
import type { EmailQuota } from './types'

const QUOTA_POLL_MS = 60_000

function parseQuotaPayload(raw: Record<string, unknown>): EmailQuota {
  const sent = Number(raw.sent ?? raw.sentToday ?? raw.todaySent ?? 0)
  const limit = Number(raw.limit ?? raw.dailyLimit ?? 450)
  const remaining = raw.remaining != null ? Number(raw.remaining) : Math.max(0, limit - sent)
  return {
    sent: Number.isFinite(sent) ? sent : 0,
    limit: Number.isFinite(limit) ? limit : 450,
    remaining: Number.isFinite(remaining) ? remaining : 0,
  }
}

export function useEmailQuota(enabled = true) {
  const [quota, setQuota] = useState<EmailQuota | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch('/api/emails/send-quota')
      if (!res.ok) return
      const json = await res.json().catch(() => ({}))
      const payload = (json.data ?? json) as Record<string, unknown>
      setQuota(parseQuotaPayload(payload))
    } catch {
      /* ignore — quota display is best-effort */
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const id = setInterval(() => void refresh(), QUOTA_POLL_MS)
    return () => clearInterval(id)
  }, [enabled, refresh])

  return { quota, loading, refresh }
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function tomorrowMorningLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return toDatetimeLocalValue(d)
}
