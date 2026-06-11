import type { APIRequestContext } from '@playwright/test'
import { SSRF_PAYLOADS, SSRF_CANARY_HOST } from '../payloads/ssrf'
import { mutateRequest } from './request-mutation'

export interface SsrfTestResult {
  field: string
  payload: string
  status: number
  passed: boolean
  detail: string
}

/**
 * Inject SSRF payloads into fields that might trigger server-side fetches.
 * Pass = no 200 with internal content, or validation error.
 */
export async function probeSsrfInInviteEmail(
  request: APIRequestContext,
): Promise<SsrfTestResult[]> {
  const results: SsrfTestResult[] = []
  for (const payload of SSRF_PAYLOADS.slice(0, 4)) {
    const res = await mutateRequest(request, {
      method: 'POST',
      path: '/api/auth/request-invite',
      data: {
        email: `test@${SSRF_CANARY_HOST}`,
        name: 'SSRF Probe',
        organizationName: payload,
        message: payload,
      },
    })
    const status = res.status()
    const body = await res.text()
    const passed =
      !body.includes('169.254.169.254') &&
      !body.includes('ami-id') &&
      (status === 400 || status === 403 || status === 429 || status === 201 || status === 200)
    results.push({
      field: 'request-invite',
      payload,
      status,
      passed,
      detail: passed ? 'No SSRF indicator in response' : 'Possible SSRF leak in response body',
    })
  }
  return results
}

export async function probeSsrfInUrlParams(
  request: APIRequestContext,
  endpoints: string[],
): Promise<SsrfTestResult[]> {
  const results: SsrfTestResult[] = []
  for (const base of endpoints) {
    for (const payload of SSRF_PAYLOADS.slice(0, 2)) {
      const path = `${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(payload)}`
      const res = await mutateRequest(request, { method: 'GET', path })
      results.push({
        field: base,
        payload,
        status: res.status(),
        passed: res.status() !== 500,
        detail: `Probe ${path} → ${res.status()}`,
      })
    }
  }
  return results
}
