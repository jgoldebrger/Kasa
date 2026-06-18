'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { GlobeAltIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Button, Select } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { formatMoney, listSupportedCurrencies } from '@/lib/currency'
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@/lib/client/i18n'

interface CurrencyMeta {
  code: string
  label: string
}

const CURRENCY_LABELS: Record<string, string> = {
  USD: 'US Dollar',
  CAD: 'Canadian Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  ILS: 'Israeli New Shekel',
  AUD: 'Australian Dollar',
  CHF: 'Swiss Franc',
  MXN: 'Mexican Peso',
  BRL: 'Brazilian Real',
  ZAR: 'South African Rand',
}

const LOCALE_LABELS: Record<Locale, string> = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'he-IL': 'עברית (Hebrew, Israel)',
  yi: 'ייִדיש (Yiddish)',
  'fr-FR': 'Français (France)',
  'es-MX': 'Español (México)',
}

export default function LocalizationPanel() {
  const toast = useToast()
  const { setLocale } = useI18n()
  const [currency, setCurrency] = useState('USD')
  const [locale, setLocaleState] = useState<Locale>('en-US')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { begin, invalidate, isStale } = useRequestGeneration()

  useEffect(() => {
    const gen = begin()
    void (async () => {
      try {
        const res = await fetch('/api/organizations/current')
        if (isStale(gen)) return
        if (!res.ok) {
          toast.error('Failed to load localization settings.')
          return
        }
        const data = await res.json().catch(() => ({}))
        if (isStale(gen)) return
        if (typeof data.currency === 'string') setCurrency(data.currency)
        if (typeof data.locale === 'string') {
          setLocaleState(data.locale as Locale)
        }
      } finally {
        if (!isStale(gen)) setLoading(false)
      }
    })()
  }, [toast, begin, isStale])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      setLoading(true)
      const gen = begin()
      void (async () => {
        try {
          const res = await fetch('/api/organizations/current')
          if (isStale(gen)) return
          if (!res.ok) {
            toast.error('Failed to load localization settings.')
            return
          }
          const data = await res.json().catch(() => ({}))
          if (isStale(gen)) return
          if (typeof data.currency === 'string') setCurrency(data.currency)
          if (typeof data.locale === 'string') {
            setLocaleState(data.locale as Locale)
          }
        } finally {
          if (!isStale(gen)) setLoading(false)
        }
      })()
    }, [toast, begin, invalidate, isStale]),
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/organizations/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency, locale }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save settings.')
        return
      }
      toast.success('Localization settings saved.')
      // Flip the UI immediately so the next paint uses the new locale.
      setLocale(locale)
    } catch {
      toast.error('Network error.')
    } finally {
      setSaving(false)
    }
  }

  const currencies: CurrencyMeta[] = listSupportedCurrencies().map((code) => ({
    code,
    label: `${code} — ${CURRENCY_LABELS[code] || code}`,
  }))

  return (
    <SettingsPanel
      icon={<GlobeAltIcon />}
      title="Localization"
      description="Change how money and dates are displayed across the app and on PDFs."
      className="space-y-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          disabled={loading || saving}
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select
          label="Display language / locale"
          value={locale}
          onChange={(e) => setLocaleState(e.target.value as Locale)}
          disabled={loading || saving}
          hint="Affects number formatting, date formatting, and translated UI strings. Hebrew + Yiddish render right-to-left."
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-md border border-border bg-app-subtle p-3 text-sm">
        <p className="font-medium text-fg mb-1">Preview</p>
        <ul className="space-y-0.5 text-fg-muted">
          <li>
            Whole amount:{' '}
            <span className="text-fg font-medium">{formatMoney(1234, { currency, locale })}</span>
          </li>
          <li>
            Fractional amount:{' '}
            <span className="text-fg font-medium">
              {formatMoney(98765.43, { currency, locale })}
            </span>
          </li>
          <li>
            Today:{' '}
            <span className="text-fg font-medium">
              {new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date())}
            </span>
          </li>
        </ul>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} disabled={loading}>
          Save changes
        </Button>
      </div>
    </SettingsPanel>
  )
}
