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
import { cachedFetch } from '@/lib/client-cache'
import {
  loadLocaleMessages,
  getCachedLocaleMessages,
  primeLocaleMessages,
  type MessageKey,
} from '@/lib/i18n/load-locale'

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
  const localeMap = getCachedLocaleMessages(locale)
  if (localeMap?.[key]) return localeMap[key]
  const base = locale.split('-')[0]
  if (base !== locale) {
    const baseMap = getCachedLocaleMessages(base as Locale)
    if (baseMap?.[key]) return baseMap[key]
  }
  const en = getCachedLocaleMessages('en-US')
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

export interface I18nProviderProps {
  children: React.ReactNode
  /** Org default locale from server — used when no per-device override exists. */
  initialOrgLocale?: string
}

export function I18nProvider({ children, initialOrgLocale }: I18nProviderProps) {
  const { status } = useSession()
  const seededOrgLocale =
    initialOrgLocale &&
    (SUPPORTED_LOCALES as readonly string[]).includes(initialOrgLocale)
      ? (initialOrgLocale as Locale)
      : null

  const [locale, setLocaleState] = useState<Locale>(seededOrgLocale ?? DEFAULT_LOCALE)
  const [, setLocaleReady] = useState(0)

  useEffect(() => {
    const stored = readStoredLocale()
    if (stored) setLocaleState(stored)
    else if (seededOrgLocale) setLocaleState(seededOrgLocale)
  }, [seededOrgLocale])

  useEffect(() => {
    let cancelled = false
    void loadLocaleMessages(locale).then(() => {
      if (!cancelled) setLocaleReady((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  useEffect(() => {
    if (status !== 'authenticated') return
    if (readStoredLocale()) return

    let cancelled = false
    const apply = (raw: string) => {
      if (cancelled) return
      if ((SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
        setLocaleState(raw as Locale)
      }
    }

    if (seededOrgLocale) {
      apply(seededOrgLocale)
      return
    }

    cachedFetch<{ locale?: string }>('/api/organizations/current', { ttl: 60_000 })
      .then((data) => {
        if (data?.locale) apply(String(data.locale))
      })
      .catch(() => {})

    const onOrgChange = () => {
      cachedFetch<{ locale?: string }>('/api/organizations/current', {
        ttl: 60_000,
        bypass: true,
      })
        .then((data) => {
          if (data?.locale) apply(String(data.locale))
        })
        .catch(() => {})
    }
    window.addEventListener('kasa:org-changed', onOrgChange)
    return () => {
      cancelled = true
      window.removeEventListener('kasa:org-changed', onOrgChange)
    }
  }, [status, seededOrgLocale])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale
    document.documentElement.dir = (RTL_LOCALES as readonly string[]).includes(locale)
      ? 'rtl'
      : 'ltr'
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    void loadLocaleMessages(next).then((msgs) => {
      primeLocaleMessages(next, msgs)
      setLocaleReady((n) => n + 1)
    })
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, next)
    } catch {}
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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
