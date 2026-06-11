/**
 * Server-only money helpers that read org currency/locale from MongoDB.
 * Keep this separate from `money.ts` so client components can import
 * pure formatting helpers without pulling in Mongoose models.
 */

import { Organization } from './models'

/** Fetch an organization's stored ISO-4217 currency (defaults to 'USD'). */
export async function getOrgCurrency(organizationId: string): Promise<string> {
  const org = await Organization.findById(organizationId).select('currency').lean<{ currency?: string }>()
  return String(org?.currency || 'USD').toUpperCase()
}

/** Fetch org currency + BCP-47 locale together (defaults: USD / en-US). */
export async function getOrgMoneyContext(
  organizationId: string,
): Promise<{ currency: string; locale: string }> {
  const org = await Organization.findById(organizationId)
    .select('currency locale')
    .lean<{ currency?: string; locale?: string }>()
  return {
    currency: String(org?.currency || 'USD').toUpperCase(),
    locale: String(org?.locale || 'en-US'),
  }
}
