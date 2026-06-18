'use client'

import { useEffect, useState } from 'react'
import { SunIcon, MoonIcon, ComputerDesktopIcon } from '@heroicons/react/24/outline'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'kasa-theme'

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * Three-state theme cycle: system → light → dark → system.
 * Coordinates with the bootstrap script in `app/layout.tsx` and listens
 * to OS-level theme changes when set to `system`.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setTheme(readStoredTheme())
  }, [])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  function cycle() {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* localStorage may be blocked (Safari private etc.) — fail quietly. */
    }
    applyTheme(next)
  }

  const Icon = theme === 'dark' ? MoonIcon : theme === 'light' ? SunIcon : ComputerDesktopIcon
  const label =
    theme === 'dark'
      ? 'Theme: dark. Click to switch to system.'
      : theme === 'light'
        ? 'Theme: light. Click to switch to dark.'
        : 'Theme: system. Click to switch to light.'

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={`focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg transition-colors ${className}`}
    >
      {mounted ? (
        <Icon className="h-5 w-5" aria-hidden="true" />
      ) : (
        <span className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  )
}
