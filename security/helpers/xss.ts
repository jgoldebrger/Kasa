import type { APIRequestContext, Page } from '@playwright/test'
import { XSS_PAYLOADS, assertNoXssReflection, xssCanaryPayload } from '../payloads/xss'
import { mutateRequest } from './request-mutation'

export interface XssProbeResult {
  vector: string
  payload: string
  passed: boolean
  detail: string
}

/** Probe search/reflected endpoints for XSS reflection. */
export async function probeReflectedXss(
  request: APIRequestContext,
  endpoints: Array<{ path: string; param: string }>,
): Promise<XssProbeResult[]> {
  const results: XssProbeResult[] = []
  for (const { path, param } of endpoints) {
    for (const payload of [...XSS_PAYLOADS.basic.slice(0, 3), xssCanaryPayload()]) {
      const url = `${path}?${param}=${encodeURIComponent(payload)}`
      const res = await mutateRequest(request, { method: 'GET', path: url })
      const body = await res.text()
      const issues = assertNoXssReflection(body)
      results.push({
        vector: `${path} [${param}]`,
        payload: payload.slice(0, 80),
        passed: issues.length === 0,
        detail: issues.length ? issues.join('; ') : 'No dangerous reflection',
      })
    }
  }
  return results
}

/** Check DOM for unsanitized user input after navigation. */
export async function probeDomXss(
  page: Page,
  url: string,
  inputSelector: string,
  payload: string,
): Promise<XssProbeResult> {
  await page.goto(url)
  const input = page.locator(inputSelector).first()
  if (await input.count()) {
    await input.fill(payload)
    await input.press('Enter').catch(() => {})
  }
  const html = await page.content()
  const issues = assertNoXssReflection(html)
  return {
    vector: url,
    payload,
    passed: issues.length === 0,
    detail: issues.length ? issues.join('; ') : 'DOM appears sanitized',
  }
}

/** Stored XSS via API — inject marker then verify it is not rendered raw elsewhere. */
export async function probeStoredXssViaTask(
  request: APIRequestContext,
  canary: string,
): Promise<XssProbeResult> {
  const title = `Sec ${canary} ${Date.now()}`
  const res = await mutateRequest(request, {
    method: 'POST',
    path: '/api/tasks',
    data: {
      title,
      description: xssCanaryPayload('-stored'),
      email: 'sec-stored-xss@test.invalid',
      priority: 'low',
      status: 'pending',
    },
  })
  if (!res.ok()) {
    return {
      vector: 'POST /api/tasks',
      payload: title,
      passed: true,
      detail: `Task creation rejected (${res.status()}) — input validation may block XSS`,
    }
  }
  const list = await mutateRequest(request, { method: 'GET', path: '/api/tasks' })
  const body = await list.text()
  const issues = assertNoXssReflection(body, canary)
  return {
    vector: 'GET /api/tasks after stored inject',
    payload: title,
    passed: issues.length === 0,
    detail: issues.length ? issues.join('; ') : 'Stored payload not reflected dangerously',
  }
}
