import { test, expect } from '@playwright/test'
import { ensureAlphaOrg, apiOk, markerFamilyId } from '../helpers'

const YEAR = new Date().getFullYear()

const GET_ENDPOINTS: Array<{ path: string; assert?: (body: unknown) => void }> = [
  { path: '/api/organizations' },
  { path: '/api/organizations/branding' },
  { path: '/api/organizations/automation' },
  { path: '/api/organizations/letterhead' },
  { path: '/api/organizations/current' },
  { path: '/api/families' },
  { path: '/api/families/balances' },
  { path: '/api/payments' },
  { path: '/api/tasks' },
  { path: '/api/calculations' },
  { path: '/api/events' },
  { path: '/api/lifecycle-event-types' },
  { path: '/api/payment-plans' },
  { path: '/api/statements' },
  { path: `/api/tax-receipts?year=${YEAR}` },
  { path: '/api/dashboard-stats' },
  { path: '/api/notifications?limit=20' },
  { path: '/api/search?q=Alpha' },
  { path: '/api/org-members' },
  { path: '/api/email-config' },
  { path: '/api/cycle-config' },
  { path: '/api/dues-recommendation' },
  { path: '/api/reports/saved' },
  { path: '/api/reports/meta' },
  { path: '/api/trash' },
  { path: '/api/audit-log?limit=10' },
  { path: '/api/family-members/all' },
  { path: '/api/recurring-payments/process' },
  { path: '/api/user' },
  { path: '/api/user/preferences' },
  { path: '/api/admin/invite-requests' },
]

test.describe('authenticated API catalog', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  for (const { path, assert } of GET_ENDPOINTS) {
    test(`GET ${path}`, async ({ page }) => {
      const res = await apiOk(page, path)
      const body = await res.json()
      if (assert) assert(body)
    })
  }

  test('GET family detail includes members and payments', async ({ page }) => {
    const id = await markerFamilyId(page)
    const res = await apiOk(page, `/api/families/${id}`)
    const body = await res.json()
    expect(body.family).toBeTruthy()
    expect(Array.isArray(body.members)).toBe(true)
    expect(Array.isArray(body.payments)).toBe(true)
  })

  test('GET member balance, payments, statements', async ({ page }) => {
    const familyId = await markerFamilyId(page)
    const fam = await (await apiOk(page, `/api/families/${familyId}`)).json()
    const memberId = fam.members[0]._id

    await apiOk(page, `/api/members/${memberId}/balance`)
    await apiOk(page, `/api/members/${memberId}/payments`)
    await apiOk(page, `/api/members/${memberId}/statements`)
  })

  test('GET family sub-resources', async ({ page }) => {
    const id = await markerFamilyId(page)
    await apiOk(page, `/api/families/${id}/sub-families`)
    await apiOk(page, `/api/families/${id}/saved-payment-methods`)
    await apiOk(page, `/api/families/${id}/withdrawals`)
    await apiOk(page, `/api/families/${id}/lifecycle-events`)
  })

  test('GET reports P&L for current year', async ({ page }) => {
    const res = await apiOk(page, `/api/reports/pl?year=${YEAR}`)
    const body = await res.json()
    expect(body.summary || body.transactions).toBeTruthy()
  })
})
