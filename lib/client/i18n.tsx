'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useSession } from 'next-auth/react'
import { messages, type MessageKey } from '@/lib/i18n/messages'

export const SUPPORTED_LOCALES = [
  'en-US',
  'en-GB',
  'he-IL',
  'yi',
  'fr-FR',
  'es-MX',
] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

const RTL_LOCALES: ReadonlyArray<Locale> = ['he-IL', 'yi']

interface I18nContextValue {
  locale: Locale
  dir: 'ltr' | 'rtl'
  t: (key: MessageKey, fallback?: string) => string
  setLocale: (locale: Locale) => void
}

const DEFAULT_LOCALE: Locale = 'en-US'

function translate(locale: Locale, key: MessageKey, fallback?: string): string {
  // First try the requested locale, then the base-language form ("he"
  // for "he-IL"), then English, then the supplied fallback / the key
  // itself. This way a partial translation never breaks the UI.
  const localeMap = (messages as any)[locale] as Record<string, string> | undefined
  if (localeMap?.[key]) return localeMap[key]
  const base = locale.split('-')[0]
  if (base !== locale) {
    const baseMap = (messages as any)[base] as Record<string, string> | undefined
    if (baseMap?.[key]) return baseMap[key]
  }
  const en = (messages as any)[DEFAULT_LOCALE] as Record<string, string>
  if (en?.[key]) return en[key]
  return fallback ?? key
}

const Ctx = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  dir: 'ltr',
  t: (k, fb) => translate(DEFAULT_LOCALE, k, fb),
  setLocale: () => {},
})

export function useI18n(): I18nContextValue {
  return useContext(Ctx)
}

/**
 * Convenience hook — returns just the `t` function so call sites can
 * stay terse: `const t = useT(); <span>{t('nav.dashboard')}</span>`.
 */
export function useT(): I18nContextValue['t'] {
  return useContext(Ctx).t
}

const LOCAL_STORAGE_KEY = 'kasa-locale'

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
      return raw as Locale
    }
  } catch {}
  return null
}

/**
 * Wraps the app and exposes `locale` / `t` to descendants. Locale is
 * derived in three layers, last write wins:
 *   1) The org's `locale` field (read from /api/organizations/current)
 *   2) localStorage override (per-device — user picks "Hebrew" once)
 *   3) Whatever the user set live via `setLocale()` on the
 *      LocalizationPanel
 *
 * The `<html>` tag's `lang` + `dir` attributes are updated in an
 * effect so search engines and assistive tech see the right values
 * after hydration.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)
  const [hydrated, setHydrated] = useState(false)

  // First-paint hydration from localStorage so the user doesn't see an
  // English flash before /api/organizations/current resolves.
  useEffect(() => {
    const stored = readStoredLocale()
    if (stored) setLocaleState(stored)
    setHydrated(true)
  }, [])

  // Pull the org's locale once authenticated. Doesn't override an
  // explicit local-storage choice (so a user who picked Hebrew on a
  // laptop doesn't get reset when their org admin flips the default).
  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false

    const fetchOrgLocale = () => {
      // Respect an explicit per-device locale override. If the user
      // picked Hebrew on their laptop, switching orgs shouldn't yank
      // them back to the new org's default.
      if (readStoredLocale()) return
      fetch('/api/organizations/current', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          const raw = String(data.locale || '')
          if ((SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
            setLocaleState(raw as Locale)
          }
        })
        .catch(() => {})
    }
    fetchOrgLocale()

    // Refetch when the active workspace changes so the UI flips to the
    // new org's configured locale right away, instead of staying in
    // the previous org's language until the next hard reload.
    const onOrgChange = () => fetchOrgLocale()
    window.addEventListener('kasa:org-changed', onOrgChange)
    return () => {
      cancelled = true
      window.removeEventListener('kasa:org-changed', onOrgChange)
    }
  }, [status])

  // Mirror locale to <html lang/dir>.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale
    document.documentElement.dir = (RTL_LOCALES as readonly string[]).includes(locale)
      ? 'rtl'
      : 'ltr'
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, next)
    } catch {}
    // Mirror into a cookie so server components (root layout) can read
    // the user's preference on the next request and emit the correct
    // <html lang/dir> server-side. 1-year SameSite=Lax matches the
    // session cookie's lifetime.
    try {
      document.cookie =
        `${LOCAL_STORAGE_KEY}=${encodeURIComponent(next)}; ` +
        `Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
    } catch {}
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: (RTL_LOCALES as readonly string[]).includes(locale) ? 'rtl' : 'ltr',
      t: (key, fb) => translate(locale, key, fb),
      setLocale,
    }),
    [locale, setLocale],
  )

  // We render children even before hydration; `t()` returns English
  // strings until the local-storage read resolves, which is fine — the
  // English strings are valid HTML in any locale and just flicker.
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
