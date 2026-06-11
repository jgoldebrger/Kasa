import { test, assertSecurityPassed } from '../playwright/fixtures'
import {
  ADMIN_ONLY_ROUTES,
  PLATFORM_ADMIN_ROUTES,
} from '../auth/roles'
import { mutateRequest } from '../helpers/request-mutation'
import { findingFromTest, recordFindings } from '../reports/writer'
import { E2E_USER } from '../../e2e/seed'

test.describe('Admin route protection', () => {
  test('guest cannot access admin API routes @guest-only', async ({ guestRequest }) => {
    const results: Array<{ path: string; status: number; passed: boolean }> = []

    for (const route of ADMIN_ONLY_ROUTES) {
      const res = await mutateRequest(guestRequest, {
        method: route.method,
        path: route.path,
        data: 'body' in route ? route.body : undefined,
      })
      const status = res.status()
      const passed = status === 401 || status === 403
      results.push({ path: route.path, status, passed })
    }

    recordFindings(
      results.map((r) =>
        findingFromTest({
          title: `guest ${r.path}`,
          category: 'authz',
          passed: r.passed,
          detail: `Status ${r.status}`,
          severity: 'high',
        }),
      ),
    )

    for (const r of results) {
      assertSecurityPassed(`guest ${r.path}`, 'authz', r.passed, `Got ${r.status}`, 'high')
    }
  })

  test('authenticated owner can reach admin routes', async ({ ownerContext }) => {
    const res = await mutateRequest(ownerContext.request, {
      method: 'GET',
      path: '/api/audit-log?limit=5',
    })
    const passed = res.ok()
    assertSecurityPassed(
      'owner audit-log access',
      'authz',
      passed,
      passed ? 'Owner allowed' : `Unexpected ${res.status()}`,
    )
  })

  test('platform admin routes require platform admin flag', async ({ ownerContext, secConfig }) => {
    const res = await mutateRequest(ownerContext.request, {
      method: 'GET',
      path: PLATFORM_ADMIN_ROUTES[0].path,
    })
    const platformAdminEmails = (
      process.env.PLATFORM_ADMIN_EMAILS ?? E2E_USER.email
    )
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    const isPlatformAdmin =
      platformAdminEmails.includes(secConfig.owner.email.toLowerCase()) ||
      secConfig.platformAdmin?.email.toLowerCase() === secConfig.owner.email.toLowerCase()
    const status = res.status()
    const passed = isPlatformAdmin ? res.ok() : status === 403 || status === 401
    assertSecurityPassed(
      'platform admin gate',
      'authz',
      passed,
      `Platform admin route → ${status} (user is${isPlatformAdmin ? '' : ' not'} platform admin)`,
      'high',
    )
  })

  test('admin UI routes redirect unauthenticated users @guest-only', async ({ guestContext }) => {
    const page = await guestContext.newPage()
    await page.goto('/settings')
    const url = page.url()
    const passed = url.includes('/login')
    assertSecurityPassed(
      'settings page auth',
      'authz',
      passed,
      passed ? 'Redirected to login' : `Accessible at ${url}`,
      'medium',
    )
  })
})
