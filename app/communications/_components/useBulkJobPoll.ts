'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface BulkJobStatus {
  jobId: string
  status: string
  totalFamilies: number
  processed: number
  sent: number
  failed: number
  remaining: number
  done: boolean
  errors: string[]
  lastError: string | null
}

const POLL_INTERVAL_MS = 2000
const TIMEOUT_MS = 10 * 60 * 1000

export function useBulkJobPoll() {
  const [status, setStatus] = useState<BulkJobStatus | null>(null)
  const [polling, setPolling] = useState(false)
  const pollGenRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      pollGenRef.current += 1
    }
  }, [])

  const clear = useCallback(() => {
    pollGenRef.current += 1
    setStatus(null)
    setPolling(false)
  }, [])

  const startPoll = useCallback(
    async (
      jobId: string,
      onComplete: (result: { sent: number; failed: number; campaignId?: string }) => void,
      campaignId?: string,
    ) => {
      pollGenRef.current += 1
      const pollGen = pollGenRef.current
      setPolling(true)
      setStatus({
        jobId,
        status: 'queued',
        totalFamilies: 0,
        processed: 0,
        sent: 0,
        failed: 0,
        remaining: 0,
        done: false,
        errors: [],
        lastError: null,
      })

      const startedAt = Date.now()
      let final: BulkJobStatus | null = null

      while (Date.now() - startedAt < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (!mountedRef.current || pollGen !== pollGenRef.current) return

        try {
          const res = await fetch(`/api/emails/send-bulk/status?jobId=${encodeURIComponent(jobId)}`)
          if (!mountedRef.current || pollGen !== pollGenRef.current) return
          if (!res.ok) continue
          const data = await res.json()
          const next: BulkJobStatus = {
            jobId: data.jobId ?? jobId,
            status: data.status ?? 'running',
            totalFamilies: data.totalFamilies ?? 0,
            processed: data.processed ?? 0,
            sent: data.sent ?? 0,
            failed: data.failed ?? 0,
            remaining: data.remaining ?? 0,
            done: Boolean(data.done),
            errors: Array.isArray(data.errors) ? data.errors : [],
            lastError: data.lastError ?? null,
          }
          setStatus(next)
          if (next.done) {
            final = next
            break
          }
        } catch {
          // transient — keep polling
        }
      }

      if (!mountedRef.current || pollGen !== pollGenRef.current) return

      setPolling(false)
      if (final) {
        onComplete({ sent: final.sent, failed: final.failed, campaignId })
        setStatus(final)
      } else {
        setStatus((prev) =>
          prev
            ? { ...prev, lastError: prev.lastError ?? 'Job still running — check Job history.' }
            : null,
        )
      }
    },
    [],
  )

  return { status, polling, startPoll, clear }
}
