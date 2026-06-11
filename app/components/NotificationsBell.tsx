'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BellIcon } from '@heroicons/react/24/outline'
import { useToast } from '@/app/components/Toast'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useT } from '@/lib/client/i18n'

interface Notification {
  _id: string
  kind: string
  title: string
  body: string
  link: string
  orgWide: boolean
  read: boolean
  createdAt: string
}

/**
 * Header bell that pulls in-app notifications and offers a dropdown
 * with mark-read affordances. Polls every 60s while open, every 5min
 * while closed — cheap to do because the response is small (~50 rows
 * max) and the endpoint is org-scoped.
 */
export default function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const t = useT()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchNotifs = useCallback(async () => {
    const gen = begin()
    try {
      setLoading(true)
      const res = await fetch('/api/notifications')
      if (isStale(gen)) return
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      if (isStale(gen)) return
      setItems(data.items || [])
      setUnread(data.unreadCount || 0)
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale])

  useEffect(() => {
    let cancelled = false
    void fetchNotifs()
    const interval = setInterval(() => {
      if (!cancelled) void fetchNotifs()
    }, open ? 60_000 : 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [fetchNotifs, open])

  useOrgChanged(useCallback(() => {
    invalidate()
    setItems([])
    setUnread(0)
    setOpen(false)
    void fetchNotifs()
  }, [fetchNotifs, invalidate]))

  // Close on outside-click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markRead = async (ids: string[] | null) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : { all: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      void fetchNotifs()
    } catch {
      toast.error('Could not mark notifications.')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('nav.notifications')}
        title={t('nav.notifications')}
        className="focus-ring relative inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg transition-colors"
      >
        <BellIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-label={`${unread} unread`}
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 right-0 z-40 w-80 sm:w-96 max-h-[70vh] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-sm font-semibold text-fg">{t('nav.notifications')}</h3>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead(null)}
                className="text-xs text-accent hover:text-accent-hover"
              >
                {t('common.markAllRead')}
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-[60vh]">
            {loading && items.length === 0 ? (
              <div className="p-4 text-center text-sm text-fg-muted">{t('common.loading')}</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-sm text-fg-muted">{t('common.empty')}</div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const body = (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm ${n.read ? 'text-fg-muted' : 'font-medium text-fg'}`}>
                          {n.title}
                        </p>
                        {!n.read && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                        )}
                      </div>
                      {n.body && (
                        <p className="text-xs text-fg-muted line-clamp-2 mt-0.5">{n.body}</p>
                      )}
                      <p className="text-[10px] text-fg-subtle mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                  )
                  const onClick = () => {
                    if (!n.read) void markRead([n._id])
                    setOpen(false)
                  }
                  // Only follow same-origin links.
                  const safeLink = n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : null
                  return (
                    <li key={n._id}>
                      {safeLink ? (
                        <Link
                          href={safeLink}
                          onClick={onClick}
                          className="flex gap-2 px-3 py-2.5 hover:bg-fg/5"
                        >
                          {body}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={onClick}
                          className="flex gap-2 w-full text-left px-3 py-2.5 hover:bg-fg/5"
                        >
                          {body}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
