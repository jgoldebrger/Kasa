import { test, expect } from '@playwright/test'
import { E2E_FIXTURES, E2E_ORGS } from '../seed'
import { ensureAlphaOrg, gotoFamilyDetail, markerFamilyId } from '../helpers'

const TAB_API_CHECKS: Array<{ tab: string; verify: (page: import('@playwright/test').Page, familyId: string) => Promise<void> }> = [
  {
    tab: 'info',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}`)
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      expect(data.family.name).toBe(E2E_ORGS.alpha.markerFamily)
      expect(data.family.email).toBe('alpha-marker@example.com')
    },
  },
  {
    tab: 'members',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}`)
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      expect(
        data.members.some(
          (m: { firstName: string; lastName: string }) =>
            m.firstName === E2E_FIXTURES.memberFirstName &&
            m.lastName === E2E_FIXTURES.memberLastName,
        ),
      ).toBe(true)
    },
  },
  {
    tab: 'payments',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}`)
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      expect(data.payments?.some((p: { amount: number }) => p.amount === 250)).toBe(true)
    },
  },
  {
    tab: 'withdrawals',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}/withdrawals`)
      expect(res.ok()).toBeTruthy()
    },
  },
  {
    tab: 'events',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}/lifecycle-events`)
      expect(res.ok()).toBeTruthy()
      const events = await res.json()
      expect(Array.isArray(events)).toBe(true)
      expect(events.some((e: { eventType: string }) => e.eventType === E2E_FIXTURES.eventTypeKey)).toBe(true)
    },
  },
  {
    tab: 'cycle-charges',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}`)
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      expect(Array.isArray(data.cycleCharges)).toBe(true)
    },
  },
  {
    tab: 'statements',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/statements?familyId=${familyId}`)
      expect(res.ok()).toBeTruthy()
      const statements = await res.json()
      expect(Array.isArray(statements)).toBe(true)
      expect(
        statements.some(
          (s: { statementNumber: string }) => s.statementNumber === E2E_FIXTURES.statementNumber,
        ),
      ).toBe(true)
    },
  },
  {
    tab: 'sub-families',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/families/${familyId}/sub-families`)
      expect(res.ok()).toBeTruthy()
      expect(Array.isArray(await res.json())).toBe(true)
    },
  },
  {
    tab: 'tasks',
    verify: async (page, familyId) => {
      const res = await page.request.get(`/api/tasks?familyId=${familyId}`)
      expect(res.ok()).toBeTruthy()
      const tasks = await res.json()
      expect(Array.isArray(tasks)).toBe(true)
      expect(tasks.some((t: { title: string }) => t.title === E2E_FIXTURES.taskTitle)).toBe(true)
    },
  },
]

test.describe('family detail', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('opens from global search', async ({ page }) => {
    test.setTimeout(240_000)
    await gotoFamilyDetail(page)
    await expect(page.getByText(/family information|wedding date/i).first()).toBeVisible({
      timeout: 120_000,
    })
  })

  for (const { tab, verify } of TAB_API_CHECKS) {
    test(`tab ${tab} API data`, async ({ page }) => {
      const familyId = await markerFamilyId(page)
      await verify(page, familyId)
    })
  }
})
