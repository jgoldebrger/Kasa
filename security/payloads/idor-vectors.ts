/** IDOR / tenant isolation test vectors. */
export type TenantSwapVector =
  | 'header-org-id'
  | 'cookie-active-org'
  | 'query-org-id'
  | 'body-org-id'

export const IDOR_RESOURCE_PATTERNS = [
  '/api/families/{id}',
  '/api/families/{id}/members',
  '/api/families/{id}/payments',
  '/api/families/{id}/withdrawals',
  '/api/families/{id}/lifecycle-events',
  '/api/families/{id}/statements',
  '/api/members/{memberId}/balance',
  '/api/members/{memberId}/payments',
  '/api/tasks/{id}',
  '/api/statements/{id}',
  '/api/payment-plans/{id}',
  '/api/lifecycle-event-types/{id}',
  '/api/tax-receipts/{familyId}/pdf',
] as const

/** Status codes that indicate access was denied (good). */
export const IDOR_SAFE_STATUSES = new Set([401, 403, 404, 400])

/** Status codes that may indicate IDOR (bad if cross-tenant). */
export const IDOR_LEAK_STATUSES = new Set([200, 201, 204])
