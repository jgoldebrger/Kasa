'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { Button } from '@/app/components/ui'
import {
  SUPPORT_MODE_REDIRECTS,
  SUPPORT_MODE_REDIRECT_LABELS,
  type SupportModeRedirect,
} from '@/lib/support-mode-redirect'

export interface SupportModeOpenButtonProps {
  loading?: boolean
  onSelect: (redirectTo: SupportModeRedirect) => void
  /** Label for the primary action (defaults to dashboard). */
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

const MENU_WIDTH = 200

export default function SupportModeOpenButton({
  loading = false,
  onSelect,
  label = 'Open as admin',
  size = 'sm',
}: SupportModeOpenButtonProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? SUPPORT_MODE_REDIRECTS.length * 40 + 8
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const top =
      spaceBelow >= menuHeight + 6 ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6)
    setPos({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScrollOrResize = () => updatePosition()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div ref={wrapRef} className="inline-flex rounded-md shadow-sm">
      <Button
        type="button"
        size={size}
        loading={loading}
        className="rounded-e-none"
        onClick={() => onSelect('/')}
      >
        {label}
      </Button>
      <Button
        type="button"
        size={size}
        loading={loading}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open as admin destination"
        className="rounded-s-none border-s border-accent-fg/20 px-2 min-w-0"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
      </Button>

      {open &&
        mounted &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-[1000] overflow-hidden rounded-md border border-border bg-surface shadow-popover"
          >
            {SUPPORT_MODE_REDIRECTS.map((redirect, idx) => (
              <button
                key={redirect}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSelect(redirect)
                }}
                className={`flex w-full items-center px-3 py-2 text-left text-sm text-fg hover:bg-fg/5 transition-colors ${
                  idx > 0 ? 'border-t border-border' : ''
                }`}
              >
                {SUPPORT_MODE_REDIRECT_LABELS[redirect]}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
