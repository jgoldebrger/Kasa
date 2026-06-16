import 'server-only'
import { cache } from 'react'
import connectDB from '@/lib/database'
import { Organization } from '@/lib/models'
import type { OrgBranding } from '@/lib/client/useOrgBranding'

export interface ServerOrgShell {
  currency: string
  locale: string
  branding: OrgBranding
}

/**
 * Slim org fields for the app shell (sidebar logo/name, currency, i18n).
 * Avoids 2–3 client round-trips on every navigation.
 */
export const loadServerOrgShell = cache(async (organizationId: string): Promise<ServerOrgShell | null> => {
  await connectDB()
  const org = await Organization.findById(organizationId)
    .select('name slug currency locale branding.logoDataUrl branding.logoUpdatedAt branding.accentColor')
    .lean<{
      name?: string
      slug?: string
      currency?: string
      locale?: string
      branding?: {
        logoDataUrl?: string | null
        logoUpdatedAt?: Date | null
        accentColor?: string | null
      }
    }>()
  if (!org) return null

  const logoUpdatedAtMs = org.branding?.logoUpdatedAt
    ? new Date(org.branding.logoUpdatedAt).getTime()
    : null
  const logoUrl = org.branding?.logoDataUrl
    ? `/api/organizations/branding/logo?v=${logoUpdatedAtMs ?? 0}`
    : null

  return {
    currency: (org.currency || 'USD').toUpperCase(),
    locale: org.locale || 'en-US',
    branding: {
      name: org.name || null,
      slug: org.slug || null,
      logoDataUrl: org.branding?.logoDataUrl || null,
      logoUrl,
      accentColor: org.branding?.accentColor || null,
    },
  }
})
