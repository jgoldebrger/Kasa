'use client'

import { OrgCurrencyProvider } from '@/lib/client/useCurrency'
import { I18nProvider } from '@/lib/client/i18n'
import { OrgBrandingProvider } from '@/lib/client/useOrgBranding'
import type { OrgBranding } from '@/lib/client/useOrgBranding'

export interface OrgShellProvidersProps {
  children: React.ReactNode
  initialCurrency?: string
  initialLocale?: string
  initialBranding?: OrgBranding | null
}

/**
 * Client wrappers that seed currency / locale / branding from the server
 * layout so the shell doesn't block on /api/organizations/* on every page.
 */
export default function OrgShellProviders({
  children,
  initialCurrency,
  initialLocale,
  initialBranding,
}: OrgShellProvidersProps) {
  return (
    <I18nProvider initialOrgLocale={initialLocale}>
      <OrgCurrencyProvider initialCurrency={initialCurrency} initialLocale={initialLocale}>
        <OrgBrandingProvider initialBranding={initialBranding ?? undefined}>
          {children}
        </OrgBrandingProvider>
      </OrgCurrencyProvider>
    </I18nProvider>
  )
}
