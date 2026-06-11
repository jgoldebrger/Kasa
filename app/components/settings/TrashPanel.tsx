'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import {
  ArrowUturnLeftIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { Button, EmptyState, SkeletonRows } from '@/app/components/ui'
import { useConfirm, useToast } from '@/app/components/Toast'

interface TrashItem {
  id: string
  kind: string
  label: string
  description: string
  deletedAt: string
  deletedBy: string | null
  deletedKind: 'manual' | 'cascade' | null
  purgesAt: string
  daysUntilPurge: number
}

interface TrashResponse {
  items: TrashItem[]
  countsByKind: Record<string, number>
  totalCount: number
}

interface TrashPanelProps {
  /** Owner can purge; admin cannot. */
  canPurge: boolean
}

const KIND_ORDER = [
  'family',
  'familyMember',
  'payment',
  'withdrawal',
  'cycleCharge',
  'statement',
  'task',
  'lifecycleEvent',
  'lifecycleEventPayment',
  'paymentPlan',
] as const

const KIND_HEADINGS: Record<string, string> = {
  family: 'Families',
  familyMember: 'Members',
  payment: 'Payments',
  withdrawal: 'Withdrawals',
  cycleCharge: 'Annual dues charges',
  statement: 'Statements',
  task: 'Tasks',
  lifecycleEvent: 'Event types',
  lifecycleEventPayment: 'Lifecycle events',
  paymentPlan: 'Payment plans',
}

export default function TrashPanel({ canPurge }: TrashPanelProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState<TrashResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const refresh = useCallback(async () => {
    const gen = begin()
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/trash', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (isStale(gen)) return
      if (!res.ok) {
        setError(true)
        toast.error(body.error || 'Failed to load recycle bin.')
        return
      }
      setData(body)
    } catch {
      if (isStale(gen)) return
      setError(true)
      toast.error('Failed to load recycle bin.')
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [toast, begin, isStale])

  useEffect(() => {
    let cancelled = false
    void refresh().finally(() => {
      if (cancelled) setData(null)
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  useOrgChanged(useCallback(() => {
    invalidate()
    setData(null)
    void refresh()
  }, [refresh, invalidate]))

  const groups = useMemo(() => {
    if (!data) return [] as { kind: string; heading: string; items: TrashItem[] }[]
    const byKind = new Map<string, TrashItem[]>()
    for (const item of data.items) {
      const list = byKind.get(item.kind) || []
      list.push(item)
      byKind.set(item.kind, list)
    }
    return KIND_ORDER
      .filter((k) => byKind.has(k))
      .map((k) => ({
        kind: k,
        heading: KIND_HEADINGS[k] || k,
        items: byKind.get(k)!,
      }))
  }, [data])

  async function handleRestore(item: TrashItem) {
    setBusy(`restore:${item.id}`)
    try {
      const res = await fetch(`/api/trash/${item.kind}/${item.id}/restore`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Failed to restore.')
        return
      }
      const restored = body.cascadeRestored
        ? ` (+${body.cascadeRestored} related)`
        : ''
      toast.success(`Restored "${item.description}"${restored}`)
      await refresh()
    } catch {
      toast.error('Failed to restore.')
    } finally {
      setBusy(null)
    }
  }

  async function handlePurge(item: TrashItem) {
    const ok = await confirm({
      title: 'Permanently delete?',
      message: `"${item.description}" will be gone for good. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      destructive: true,
    })
    if (!ok) return
    setBusy(`purge:${item.id}`)
    try {
      const res = await fetch(`/api/trash/${item.kind}/${item.id}`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Failed to delete.')
        return
      }
      toast.success(`Permanently deleted "${item.description}"`)
      await refresh()
    } catch {
      toast.error('Failed to delete.')
    } finally {
      setBusy(null)
    }
  }

  async function handlePurgeAll() {
    if (!data || data.totalCount === 0) return
    const ok = await confirm({
      title: 'Empty the recycle bin?',
      message: `${data.totalCount} item${data.totalCount === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Empty bin',
      destructive: true,
    })
    if (!ok) return
    setBusy('purge:all')
    try {
      const res = await fetch('/api/trash/purge-all', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Failed to empty bin.')
        return
      }
      toast.success(body.message || 'Recycle bin emptied.')
      await refresh()
    } catch {
      toast.error('Failed to empty bin.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="surface-card p-6">
        <SkeletonRows count={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="surface-card p-6">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Couldn't load the recycle bin"
          description="Try again in a moment."
          cta={{ label: 'Retry', onClick: () => void refresh() }}
        />
      </div>
    )
  }

  if (!data || data.totalCount === 0) {
    return (
      <div className="surface-card p-6">
        <EmptyState
          icon={<TrashIcon />}
          title="Recycle bin is empty"
          description={`Deleted items appear here for ${30} days before they're purged automatically.`}
          cta={null}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{data.totalCount}</span> item
          {data.totalCount === 1 ? '' : 's'} in the recycle bin. Items are
          purged automatically after 30 days.
        </div>
        {canPurge && (
          <Button
            variant="destructive"
            size="sm"
            leftIcon={<TrashIcon className="h-4 w-4" />}
            loading={busy === 'purge:all'}
            onClick={handlePurgeAll}
          >
            Empty bin
          </Button>
        )}
      </div>

      {groups.map((group) => (
        <section key={group.kind} className="surface-card overflow-hidden">
          <header className="flex items-center justify-between border-b border-border bg-app-subtle px-4 py-2.5">
            <h3 className="text-sm font-semibold text-fg">
              {group.heading}{' '}
              <span className="ml-1 text-xs font-normal text-fg-muted">
                ({group.items.length})
              </span>
            </h3>
          </header>
          <ul className="divide-y divide-border">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">
                    {item.description}
                  </div>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    Deleted {formatRelative(item.deletedAt)}
                    {item.deletedKind === 'cascade' && (
                      <span className="ml-2 inline-flex items-center rounded-full border border-border bg-app-subtle px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">
                        cascade
                      </span>
                    )}
                    {' · '}
                    <span className={item.daysUntilPurge <= 3 ? 'text-amber-600 dark:text-amber-400' : ''}>
                      purges in {item.daysUntilPurge} day
                      {item.daysUntilPurge === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                    loading={busy === `restore:${item.id}`}
                    onClick={() => handleRestore(item)}
                  >
                    Restore
                  </Button>
                  {canPurge && (
                    <Button
                      variant="destructive"
                      size="sm"
                      leftIcon={<TrashIcon className="h-4 w-4" />}
                      loading={busy === `purge:${item.id}`}
                      onClick={() => handlePurge(item)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}
