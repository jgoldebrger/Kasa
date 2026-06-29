import { cachedFetch } from '@/lib/client-cache'

/** Resolve the active org id for queue scoping (matches OrgSwitcher / OrgRole). */
export async function resolveActiveOrgId(): Promise<string | null> {
  try {
    const data = await cachedFetch<{
      activeOrgId?: string | null
      organizations?: { id: string }[]
    }>('/api/organizations', { ttl: 60_000 })
    return data.activeOrgId ?? data.organizations?.[0]?.id ?? null
  } catch {
    return null
  }
}
