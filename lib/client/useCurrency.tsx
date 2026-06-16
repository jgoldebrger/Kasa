'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { cachedFetch } from '@/lib/client-cache'
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

export function useCurrency(): CurrencyContextValue {
  return useContext(Ctx)
}

export interface OrgCurrencyProviderProps {
  children: React.ReactNode
  initialCurrency?: string
  initialLocale?: string
}

export function OrgCurrencyProvider({
  children,
  initialCurrency,
  initialLocale,
}: OrgCurrencyProviderProps) {
  const { data: session, status } = useSession()
  const sessionUserId = session?.user?.id
  const serverSeeded = initialCurrency !== undefined
  const [currency, setCurrency] = useState(
    (initialCurrency || 'USD').toUpperCase(),
  )
  const [locale, setLocale] = useState(initialLocale || 'en-US')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false

    const fetchCurrent = (opts?: { bypass?: boolean }) => {
      setLoading(true)
      cachedFetch<{ currency?: string; locale?: string }>(
        '/api/organizations/current',
        { ttl: 60_000, bypass: opts?.bypass },
      )
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

    if (!serverSeeded) {
      fetchCurrent()
    }

    const onOrgChange = () => fetchCurrent({ bypass: true })
    window.addEventListener('kasa:org-changed', onOrgChange)
    return () => {
      cancelled = true
      window.removeEventListener('kasa:org-changed', onOrgChange)
    }
  }, [status, sessionUserId, serverSeeded])

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
