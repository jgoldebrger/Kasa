import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { findSessionCookie } from '../auth/bootstrap'
import { mutateRequest, tamperCookieValue } from './request-mutation'

export interface AuthBypassResult {
  test: string
  passed: boolean
  status?: number
  detail: string
}

/** Verify protected routes reject unauthenticated callers. */
export async function testUnauthenticatedAccess(
  request: APIRequestContext,
  paths: string[],
): Promise<AuthBypassResult[]> {
  const results: AuthBypassResult[] = []
  for (const path of paths) {
    const res = await mutateRequest(request, { method: 'GET', path, stripOrigin: false })
    const status = res.status()
    const passed = status === 401 || status === 403 || status === 307
    results.push({
      test: `unauth GET ${path}`,
      passed,
      status,
      detail: passed ? 'Access denied as expected' : `Unexpected status ${status} — possible auth bypass`,
    })
  }
  return results
}

/** Verify protected pages redirect to login without session. */
export async function testPageAuthRedirect(
  page: Page,
  paths: string[],
): Promise<AuthBypassResult[]> {
  const results: AuthBypassResult[] = []
  for (const path of paths) {
    await page.goto(path)
    const url = page.url()
    const passed = url.includes('/login') || url.includes('/welcome')
    results.push({
      test: `page redirect ${path}`,
      passed,
      detail: passed ? `Redirected to ${url}` : `Stayed on ${url} without auth`,
    })
  }
  return results
}

/** Tamper session cookie and verify session is rejected. */
export async function testSessionTampering(
  context: BrowserContext,
  probePath: string,
): Promise<AuthBypassResult[]> {
  const cookies = await context.cookies()
  const session = findSessionCookie(cookies)
  if (!session) {
    return [{ test: 'session tamper', passed: false, detail: 'No session cookie found' }]
  }

  const tampered = cookies.map((c) =>
    c.name === session.name ? { ...c, value: tamperCookieValue(c.value) } : c,
  )
  await context.clearCookies()
  await context.addCookies(tampered)

  const res = await context.request.get(probePath)
  const status = res.status()
  const passed = status === 401 || status === 403
  return [
    {
      test: 'tampered session cookie',
      passed,
      status,
      detail: passed ? 'Tampered session rejected' : `Tampered session accepted (${status})`,
    },
  ]
}

export async function testJwtOrSessionRequired(
  context: BrowserContext,
  adminPaths: string[],
): Promise<AuthBypassResult[]> {
  await context.clearCookies()
  const results: AuthBypassResult[] = []
  for (const path of adminPaths) {
    const res = await context.request.get(path)
    const status = res.status()
    const passed = status === 401 || status === 403
    results.push({
      test: `cleared cookies GET ${path}`,
      passed,
      status,
      detail: passed ? 'Denied without session' : `Got ${status} without session`,
    })
  }
  return results
}
