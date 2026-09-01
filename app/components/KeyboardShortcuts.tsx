'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useOrgRole } from '@/lib/client/useOrgRole'
import type { MessageKey } from '@/lib/i18n/load-locale'
import { PRIMARY_NAV_SECTIONS, filterNavSections } from '@/lib/nav'
import { getNavShortcutHelpItems } from '@/lib/nav/shortcuts'

const GO_SEQUENCE_MS = 1000

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

interface ShortcutRow {
  keys: string
  labelKey: MessageKey
}

export default function KeyboardShortcuts() {
  const router = useRouter()
  const t = useT()
  const { isAdmin } = useOrgRole()
  const [helpOpen, setHelpOpen] = useState(false)

  // Only register/show shortcuts for destinations the current user can see —
  // derive the shortcut map from the same role-filtered tree the Sidebar uses.
  const navShortcuts = useMemo(() => {
    const filtered = filterNavSections(PRIMARY_NAV_SECTIONS, {
      isAdmin,
      isPlatformAdmin: false,
    })
    return getNavShortcutHelpItems(filtered)
  }, [isAdmin])

  const goRoutes = useMemo(
    () =>
      Object.fromEntries(
        navShortcuts.flatMap((item) => {
          const [prefix, key] = item.keys.split(' ')
          return prefix === 'g' && key && item.href ? [[key, item.href]] : []
        }),
      ),
    [navShortcuts],
  )

  const shortcutRows = useMemo<ShortcutRow[]>(
    () => [
      { keys: '?', labelKey: 'shortcuts.showHelp' },
      { keys: '/', labelKey: 'shortcuts.openSearch' },
      { keys: 'Ctrl+K', labelKey: 'shortcuts.openSearch' },
      ...navShortcuts.map((item) => ({
        keys: item.keys,
        labelKey: item.labelKey as MessageKey,
      })),
    ],
    [navShortcuts],
  )
  const goPendingRef = useRef(false)
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearGoPending = useCallback(() => {
    goPendingRef.current = false
    if (goTimerRef.current) {
      clearTimeout(goTimerRef.current)
      goTimerRef.current = null
    }
  }, [])

  const startGoPending = useCallback(() => {
    clearGoPending()
    goPendingRef.current = true
    goTimerRef.current = setTimeout(() => {
      goPendingRef.current = false
      goTimerRef.current = null
    }, GO_SEQUENCE_MS)
  }, [clearGoPending])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      if (e.key === '?' && !helpOpen) {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      if (goPendingRef.current) {
        const route = goRoutes[e.key]
        if (route) {
          e.preventDefault()
          clearGoPending()
          router.push(route)
        } else if (e.key !== 'g') {
          clearGoPending()
        }
        return
      }

      if (e.key === 'g') {
        e.preventDefault()
        startGoPending()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearGoPending()
    }
  }, [router, helpOpen, clearGoPending, startGoPending, goRoutes])

  return (
    <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t('shortcuts.title')}>
      <p className="mb-4 text-sm text-fg-muted">{t('shortcuts.subtitle')}</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {shortcutRows.map((row) => (
          <li
            key={row.keys + row.labelKey}
            className="flex items-center justify-between gap-4 px-3 py-2.5"
          >
            <span className="text-sm text-fg">{t(row.labelKey)}</span>
            <kbd className="shrink-0 rounded bg-fg/10 px-2 py-0.5 font-mono text-xs text-fg-muted">
              {row.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
