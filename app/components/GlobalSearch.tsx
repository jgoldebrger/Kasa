'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

import { createPortal } from 'react-dom'

import { useRouter } from 'next/navigation'

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { OPEN_GLOBAL_SEARCH } from '@/lib/client/open-global-search'
import { useOrgRole } from '@/lib/client/useOrgRole'
import { useT } from '@/lib/client/i18n'
import {
  buildGroupedSearchResults,
  type ApiSearchRecord,
  type GroupedSearchItem,
} from '@/lib/client/global-search-items'

export interface GlobalSearchProps {
  /** Compact magnifying-glass trigger for the mobile top bar. */

  variant?: 'default' | 'icon'

  /** Present results in a full-width modal on small screens. */

  mobileFullscreen?: boolean
}

function recordBadgeClass(type: ApiSearchRecord['type']): string {
  switch (type) {
    case 'family':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case 'member':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'payment':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-300'
    case 'task':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'event':
      return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
    default:
      return 'bg-fg/10 text-fg-muted'
  }
}

/**

 * Header search box. Click (or press `/` / Ctrl-K) to open, type to

 * query `/api/search`, arrow-keys to select, Enter to navigate.

 *

 * Debounced 200ms — small enough to feel instant, large enough that we

 * don't fire a request on every keystroke.

 */

export default function GlobalSearch({
  variant = 'default',

  mobileFullscreen = false,
}: GlobalSearchProps) {
  const router = useRouter()
  const t = useT()
  const { isAdmin } = useOrgRole()

  const [open, setOpen] = useState(false)

  const [q, setQ] = useState('')

  const [records, setRecords] = useState<ApiSearchRecord[]>([])

  const [loading, setLoading] = useState(false)

  const [activeIndex, setActiveIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchGenRef = useRef(0)

  const groupLabels = useMemo(
    () => ({
      actions: t('search.group.actions'),
      pages: t('search.group.pages'),
      records: t('search.group.records'),
    }),
    [t],
  )

  const { groups, flatItems } = useMemo(
    () =>
      buildGroupedSearchResults({
        query: q,
        isAdmin,
        t,
        groupLabels,
        records: q.trim() ? records : [],
      }),
    [q, isAdmin, t, groupLabels, records],
  )

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const openSearch = useCallback(() => {
    setOpen(true)

    setTimeout(() => inputRef.current?.focus(), 10)
  }, [])

  // Keyboard shortcut: `/` (when not in another input) or Ctrl/Cmd+K.

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null

      const isTyping =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (
        (e.key === '/' && !isTyping) ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')
      ) {
        e.preventDefault()

        openSearch()
      }

      if (e.key === 'Escape') {
        close()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [close, openSearch])

  useEffect(() => {
    const onOpen = () => openSearch()
    window.addEventListener(OPEN_GLOBAL_SEARCH, onOpen)
    return () => window.removeEventListener(OPEN_GLOBAL_SEARCH, onOpen)
  }, [openSearch])

  // Close on outside click (dropdown mode only — fullscreen uses backdrop).

  useEffect(() => {
    if (!open || mobileFullscreen) return

    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close()
    }

    document.addEventListener('mousedown', onClick)

    return () => document.removeEventListener('mousedown', onClick)
  }, [close, mobileFullscreen, open])

  // Lock body scroll while the mobile fullscreen panel is open.

  useEffect(() => {
    if (!open || !mobileFullscreen) return

    const prevOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [mobileFullscreen, open])

  useOrgChanged(
    useCallback(() => {
      searchGenRef.current += 1

      setQ('')

      setRecords([])

      setOpen(false)

      setActiveIndex(0)
    }, []),
  )

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(flatItems.length - 1, 0)))
  }, [flatItems.length])

  // Debounced fetch with abort: each keystroke cancels the in-flight

  // request from the prior debounce window. Without this, a fast typist

  // could see results from an earlier query overwrite results from a

  // newer one when the network responds out of order.

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!q.trim()) {
      setRecords([])

      setLoading(false)

      return
    }

    setLoading(true)

    const controller = new AbortController()

    debounceRef.current = setTimeout(async () => {
      const gen = searchGenRef.current

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, {
          signal: controller.signal,
        })

        if (gen !== searchGenRef.current) return

        if (!res.ok) {
          setRecords([])

          return
        }

        const data = await res.json().catch(() => ({}))

        if (gen !== searchGenRef.current) return

        setRecords(data.items || [])

        setActiveIndex(0)
      } catch (err: any) {
        if (err?.name === 'AbortError') return

        if (gen !== searchGenRef.current) return

        setRecords([])
      } finally {
        if (gen === searchGenRef.current) setLoading(false)
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)

      controller.abort()
    }
  }, [q])

  const selectItem = useCallback(
    (item: GroupedSearchItem) => {
      if (item.run) {
        item.run()
      } else if (item.href) {
        router.push(item.href)
      }

      close()

      setQ('')
    },
    [router, close],
  )

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()

      setActiveIndex((i) => Math.min(i + 1, Math.max(flatItems.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()

      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flatItems[activeIndex]) {
      e.preventDefault()

      selectItem(flatItems[activeIndex])
    }
  }

  let flatOffset = 0

  const searchPanel = (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" />

        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t('search.placeholder')}
          className="min-h-[var(--touch-target)] flex-1 bg-transparent text-base text-fg placeholder:text-fg-subtle focus:outline-none md:min-h-0 md:text-sm"
        />

        {mobileFullscreen && (
          <button
            type="button"
            onClick={close}
            aria-label={t('search.close')}
            className="focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {!mobileFullscreen && q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label={t('search.clear')}
            className="focus-ring inline-flex h-9 w-9 items-center justify-center text-fg-muted hover:text-fg"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div
        className={
          mobileFullscreen
            ? 'max-h-[calc(100vh-4rem)] overflow-y-auto'
            : 'max-h-[60vh] overflow-y-auto'
        }
      >
        {loading && q.trim() && flatItems.length === 0 ? (
          <div className="px-3 py-4 text-sm text-fg-muted">{t('search.searching')}</div>
        ) : flatItems.length === 0 ? (
          <div className="px-3 py-4 text-sm text-fg-muted">{t('search.noMatches')}</div>
        ) : (
          <div role="listbox" aria-label={t('nav.search')}>
            {groups.map((group) => {
              const groupStart = flatOffset
              const groupItems = group.items.map((item, i) => {
                const globalIndex = groupStart + i
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={globalIndex === activeIndex}
                    onClick={() => selectItem(item)}
                    onMouseEnter={() => setActiveIndex(globalIndex)}
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left md:py-2 ${
                      globalIndex === activeIndex ? 'bg-accent/10' : 'hover:bg-fg/5'
                    }`}
                  >
                    {item.group === 'records' && item.recordType ? (
                      <span
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${recordBadgeClass(item.recordType)}`}
                      >
                        {item.recordType}
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          item.group === 'actions'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-fg/10 text-fg-muted'
                        }`}
                      >
                        {item.group === 'actions'
                          ? t('search.badge.action')
                          : t('search.badge.page')}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">{item.label}</p>

                      {item.sublabel && (
                        <p className="truncate text-xs text-fg-muted">{item.sublabel}</p>
                      )}
                    </div>
                  </button>
                )
              })
              flatOffset += group.items.length
              return (
                <div key={group.id}>
                  <p className="sticky top-0 z-10 bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {group.label}
                  </p>
                  <ul>{groupItems}</ul>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  const fullscreenOverlay =
    open && mobileFullscreen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.search')}
          >
            <div
              className="absolute inset-0 bg-black/40 animate-ui-fade"
              onClick={close}
              aria-hidden="true"
            />

            <div className="relative animate-ui-slide border-b border-border bg-surface shadow-xl">
              {searchPanel}
            </div>
          </div>,

          document.body,
        )
      : null

  const searchAriaLabel = t('search.shortcutHint')

  return (
    <div ref={containerRef} className="relative min-w-0">
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={openSearch}
          aria-label={searchAriaLabel}
          title={t('search.shortcutTitle')}
          className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
        >
          <MagnifyingGlassIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openSearch}
          className="focus-ring inline-flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-app-subtle px-2.5 py-1.5 text-xs text-fg-muted hover:bg-fg/5 hover:text-fg"
          aria-label={searchAriaLabel}
          title={t('search.shortcutTitle')}
        >
          <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />

          <span className="min-w-0 flex-1 truncate text-start">{t('nav.search.placeholder')}</span>

          <kbd className="shrink-0 rounded bg-fg/10 px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
      )}

      {open && !mobileFullscreen && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {searchPanel}
        </div>
      )}

      {fullscreenOverlay}
    </div>
  )
}
