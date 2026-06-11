'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { formatMoney, currencySymbol } from '@/lib/currency'

interface CurrencyContextValue {
  currency: string
  locale: string
  format: (value: number | null | undefined, opts?: { noSymbol?: boolean }) => string
  symbol: string
  loading: boolean
}

const DEFAULT_VALUE: CurrencyContextValue = {
  currency: 'USD',
  locale: 'en-US',
  format: (v) => formatMoney(v, { currency: 'USD', locale: 'en-US' }),
  symbol: '$',
  loading: false,
}

const Ctx = createContext<CurrencyContextValue>(DEFAULT_VALUE)

/**
 * Hook used by any component that needs to format money. Reads the
 * current org's currency / locale from the API (cached for the
 * session). Always returns a working formatter — never blocks
 * rendering on the network.
 */
export function useCurrency(): CurrencyContextValue {
  return useContext(Ctx)
}

/**
 * Provider — mount once at the top of the app shell. Fetches
 * `/api/organizations/current` exactly once per session and stashes the
 * currency / locale in context so every consumer is consistent without
 * waterfall fetches.
 */
export function OrgCurrencyProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const sessionUserId = session?.user?.id
  const [currency, setCurrency] = useState('USD')
  const [locale, setLocale] = useState('en-US')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false

    const fetchCurrent = () => {
      setLoading(true)
      fetch('/api/organizations/current', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          if (typeof data.currency === 'string') setCurrency(data.currency.toUpperCase())
          if (typeof data.locale === 'string') setLocale(data.locale)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    fetchCurrent()

    // Refetch whenever OrgSwitcher dispatches `kasa:org-changed` so
    // currency/locale update *immediately* on workspace switch, instead
    // of users seeing the prior org's $ / en-US until the next hard
    // navigation.
    const onOrgChange = () => fetchCurrent()
    window.addEventListener('kasa:org-changed', onOrgChange)
    return () => {
      cancelled = true
      window.removeEventListener('kasa:org-changed', onOrgChange)
    }
  }, [status, sessionUserId])

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      locale,
      symbol: currencySymbol(currency, locale),
      format: (v, opts) =>
        formatMoney(v, { currency, locale, noSymbol: opts?.noSymbol }),
      loading,
    }),
    [currency, locale, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
