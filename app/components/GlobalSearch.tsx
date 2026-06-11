'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'

interface SearchResult {
  type: 'family' | 'member' | 'payment'
  id: string
  label: string
  sublabel: string
  href: string
}

/**
 * Header search box. Click (or press `/` / Ctrl-K) to open, type to
 * query `/api/search`, arrow-keys to select, Enter to navigate.
 *
 * Debounced 200ms — small enough to feel instant, large enough that we
 * don't fire a request on every keystroke.
 */
export default function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchGenRef = useRef(0)

  // Keyboard shortcut: `/` (when not in another input) or Ctrl/Cmd+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.key === '/' && !isTyping) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 10)
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  useOrgChanged(useCallback(() => {
    searchGenRef.current += 1
    setQ('')
    setResults([])
    setOpen(false)
    setActiveIndex(0)
  }, []))

  // Debounced fetch with abort: each keystroke cancels the in-flight
  // request from the prior debounce window. Without this, a fast typist
  // could see results from an earlier query overwrite results from a
  // newer one when the network responds out of order.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setResults([])
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
          setResults([])
          return
        }
        const data = await res.json().catch(() => ({}))
        if (gen !== searchGenRef.current) return
        setResults(data.items || [])
        setActiveIndex(0)
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        if (gen !== searchGenRef.current) return
        setResults([])
      } finally {
        if (gen === searchGenRef.current) setLoading(false)
      }
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [q])

  const navigate = (href: string) => {
    router.push(href)
    setOpen(false)
    setQ('')
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault()
      navigate(results[activeIndex].href)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setTimeout(() => inputRef.current?.focus(), 10)
        }}
        className="focus-ring inline-flex items-center gap-2 rounded-md border border-border bg-app-subtle px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-fg/5 w-full max-w-[180px]"
        aria-label="Search"
        title="Search (Ctrl+K)"
      >
        <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate flex-1 text-left">Search…</span>
        <kbd className="shrink-0 rounded bg-fg/10 px-1 py-0.5 text-[10px] font-mono">⌘K</kbd>
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 right-0 sm:left-auto sm:right-0 z-50 w-[min(92vw,420px)] rounded-lg border border-border bg-surface shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <MagnifyingGlassIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search families, members, payments…"
              className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Clear"
                className="text-fg-muted hover:text-fg"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {!q.trim() ? (
              <div className="px-3 py-4 text-xs text-fg-muted">
                Start typing to search. Use ↑ ↓ to navigate, Enter to open.
              </div>
            ) : loading && results.length === 0 ? (
              <div className="px-3 py-4 text-sm text-fg-muted">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-sm text-fg-muted">No matches.</div>
            ) : (
              <ul role="listbox">
                {results.map((r, i) => (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === activeIndex}
                      onClick={() => navigate(r.href)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 ${
                        i === activeIndex ? 'bg-accent/10' : 'hover:bg-fg/5'
                      }`}
                    >
                      <span
                        className={`text-[10px] uppercase font-semibold tracking-wide rounded-sm px-1.5 py-0.5 shrink-0 ${
                          r.type === 'family'
                            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                            : r.type === 'member'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'bg-purple-500/10 text-purple-700 dark:text-purple-300'
                        }`}
                      >
                        {r.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg truncate">{r.label}</p>
                        {r.sublabel && (
                          <p className="text-xs text-fg-muted truncate">{r.sublabel}</p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
