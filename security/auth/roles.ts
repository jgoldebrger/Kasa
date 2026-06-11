import type { APIRequestContext, Page } from '@playwright/test'
import { getSecurityConfig } from '../config'

export type OrgRole = 'owner' | 'admin' | 'member'

export interface OrgContext {
  id: string
  name: string
  role: OrgRole
}

export interface OrganizationListResponse {
  organizations?: Array<{ id: string; name: string; role: string }>
  activeOrgId?: string | null
}

export async function fetchOrganizations(
  request: APIRequestContext,
): Promise<OrganizationListResponse> {
  const res = await request.get('/api/organizations')
  if (!res.ok()) throw new Error(`GET /api/organizations failed: ${res.status()}`)
  return res.json()
}

export async function activateOrganization(
  page: Page,
  orgName: string,
): Promise<OrgContext> {
  const config = getSecurityConfig()
  const res = await page.request.get('/api/organizations')
  if (!res.ok()) throw new Error(`Failed to load orgs: ${res.status()}`)
  const data = (await res.json()) as OrganizationListResponse
  const org = data.organizations?.find((o) => o.name === orgName)
  if (!org?.id) throw new Error(`Org not found: ${orgName}`)

  if (data.activeOrgId !== org.id) {
    const origin = new URL(config.baseUrl).origin
    const patch = await page.request.patch('/api/organizations', {
      data: { activeOrgId: org.id },
      headers: { origin, referer: `${origin}/` },
    })
    if (!patch.ok()) throw new Error(`Failed to switch org: ${patch.status()}`)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('kasa:org-changed'))
    })
  }

  return { id: org.id, name: org.name, role: org.role as OrgRole }
}

export async function getOrgByName(
  request: APIRequestContext,
  orgName: string,
): Promise<OrgContext | null> {
  const data = await fetchOrganizations(request)
  const org = data.organizations?.find((o) => o.name === orgName)
  if (!org) return null
  return { id: org.id, name: org.name, role: org.role as OrgRole }
}

export function alphaOrgName(): string {
  return getSecurityConfig().orgNames.alpha
}

export function betaOrgName(): string {
  return getSecurityConfig().orgNames.beta
}

/** Admin-only API routes (minRole admin). Used for role matrix testing. */
export const ADMIN_ONLY_ROUTES = [
  { method: 'GET' as const, path: '/api/audit-log?limit=5' },
  { method: 'GET' as const, path: '/api/email-config' },
  { method: 'POST' as const, path: '/api/payment-plans', body: { name: 'SecTest', yearlyPrice: 1 } },
  { method: 'GET' as const, path: '/api/org-members' },
  { method: 'POST' as const, path: '/api/import' },
  { method: 'GET' as const, path: '/api/trash' },
] as const

export const PLATFORM_ADMIN_ROUTES = [
  { method: 'GET' as const, path: '/api/admin/invite-requests' },
] as const

export const MEMBER_ALLOWED_ROUTES = [
  { method: 'GET' as const, path: '/api/families' },
  { method: 'GET' as const, path: '/api/search?q=test' },
  { method: 'GET' as const, path: '/api/notifications?limit=5' },
  { method: 'GET' as const, path: '/api/dashboard-stats' },
] as const
