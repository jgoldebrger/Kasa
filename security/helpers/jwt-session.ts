import type { BrowserContext } from '@playwright/test'
import { findSessionCookie } from '../auth/bootstrap'
import { tamperCookieValue } from './request-mutation'

export interface JwtSessionTestResult {
  test: string
  passed: boolean
  status?: number
  detail: string
}

/**
 * Auth.js v5 uses encrypted JWE session cookies — we cannot decode JWT claims
 * client-side. These tests validate session integrity via cookie tampering and
 * revocation behavior.
 */
export async function testEncryptedSessionTampering(
  context: BrowserContext,
  probePath = '/api/user',
): Promise<JwtSessionTestResult[]> {
  const results: JwtSessionTestResult[] = []
  const cookies = await context.cookies()
  const session = findSessionCookie(cookies)

  if (!session) {
    return [{ test: 'session present', passed: false, detail: 'No authjs session cookie' }]
  }

  // Truncate cookie
  await context.clearCookies()
  await context.addCookies([{ ...session, value: session.value.slice(0, 16) }])
  let res = await context.request.get(probePath)
  results.push({
    test: 'truncated session cookie',
    passed: res.status() === 401 || res.status() === 403,
    status: res.status(),
    detail: `Truncated cookie → ${res.status()}`,
  })

  // Random garbage
  await context.clearCookies()
  await context.addCookies([{ ...session, value: 'garbage.invalid.token' }])
  res = await context.request.get(probePath)
  results.push({
    test: 'garbage session cookie',
    passed: res.status() === 401 || res.status() === 403,
    status: res.status(),
    detail: `Garbage cookie → ${res.status()}`,
  })

  // Bit-flip tamper
  await context.clearCookies()
  await context.addCookies([{ ...session, value: tamperCookieValue(session.value) }])
  res = await context.request.get(probePath)
  results.push({
    test: 'bit-flip session cookie',
    passed: res.status() === 401 || res.status() === 403,
    status: res.status(),
    detail: `Tampered cookie → ${res.status()}`,
  })

  return results
}

export async function testSessionFixation(
  context: BrowserContext,
  loginFn: () => Promise<void>,
  probePath = '/api/user',
): Promise<JwtSessionTestResult> {
  const pre = await context.cookies()
  const preSession = findSessionCookie(pre)
  await loginFn()
  const post = await context.cookies()
  const postSession = findSessionCookie(post)

  if (!postSession) {
    return { test: 'session fixation', passed: false, detail: 'No session after login' }
  }

  const rotated =
    !preSession || preSession.value !== postSession.value || preSession.name !== postSession.name
  const res = await context.request.get(probePath)
  return {
    test: 'session fixation',
    passed: rotated && res.ok(),
    status: res.status(),
    detail: rotated
      ? 'Session token rotated after login'
      : 'Session token unchanged after login — possible fixation',
  }
}

export function extractAuthHeaders(
  cookies: Array<{ name: string; value: string }>,
): Record<string, string> {
  const session = findSessionCookie(cookies)
  if (!session) return {}
  return { Cookie: `${session.name}=${session.value}` }
}
