'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import ConfirmDialog from './ConfirmDialog'

type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
  show: (message: string, kind?: ToastKind) => void
}

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((v: boolean) => void) | null
}

const ToastContext = createContext<ToastApi | null>(null)
const ConfirmContext = createContext<ConfirmFn | null>(null)

const DEFAULT_DURATION_MS = 4000

const ICONS: Record<ToastKind, React.ComponentType<{ className?: string }>> = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
}

const COLORS: Record<ToastKind, string> = {
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  info: 'border-border bg-surface text-fg',
}

const ICON_COLORS: Record<ToastKind, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-accent',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = Date.now() + Math.random()
      setToasts((cur) => [...cur, { id, kind, message }])
      setTimeout(() => remove(id), DEFAULT_DURATION_MS)
    },
    [remove]
  )

  const api: ToastApi = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
    warning: (m) => show(m, 'warning'),
  }

  // ----- Confirm modal -----
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    message: '',
    resolve: null,
  })

  const confirmFn = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      const normalized: ConfirmOptions =
        typeof opts === 'string' ? { message: opts } : opts
      setConfirmState({
        open: true,
        resolve,
        ...normalized,
      })
    })
  }, [])

  const resolveConfirm = useCallback(
    (answer: boolean) => {
      confirmState.resolve?.(answer)
      setConfirmState((s) => ({ ...s, open: false, resolve: null }))
    },
    [confirmState]
  )

  return (
    <ToastContext.Provider value={api}>
      <ConfirmContext.Provider value={confirmFn}>
        {children}
        <div
          className="fixed top-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 pointer-events-none"
          role="region"
          aria-label="Notifications"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((t) => (
            <ToastView key={t.id} toast={t} onClose={() => remove(t.id)} />
          ))}
        </div>
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          destructive={confirmState.destructive}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const Icon = ICONS[toast.kind]
  const [entering, setEntering] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 10)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-3 border rounded-lg shadow-popover px-4 py-3 transition-all duration-200 ${
        COLORS[toast.kind]
      } ${entering ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'}`}
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${ICON_COLORS[toast.kind]}`} />
      <p className="flex-1 text-sm whitespace-pre-wrap break-words">{toast.message}</p>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="opacity-60 hover:opacity-100 transition-opacity"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Hook for showing toast notifications from any client component.
 * Falls back to console.log if used outside the provider so dev mistakes
 * don't crash the app.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  return {
    show: (m) => console.log('[toast]', m),
    success: (m) => console.log('[toast.success]', m),
    error: (m) => console.error('[toast.error]', m),
    info: (m) => console.log('[toast.info]', m),
    warning: (m) => console.warn('[toast.warning]', m),
  }
}

/**
 * Hook returning an async confirm() function backed by an in-app modal.
 *   const confirm = useConfirm()
 *   if (!(await confirm('Are you sure?'))) return
 *   if (!(await confirm({ message: 'Delete X?', destructive: true }))) return
 *
 * Falls back to window.confirm if used outside the provider so flows still
 * work even if a developer forgets to wrap in ToastProvider.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (ctx) return ctx
  return async (opts) => {
    if (typeof window === 'undefined') return false
    const msg = typeof opts === 'string' ? opts : opts.message
    return window.confirm(msg)
  }
}
