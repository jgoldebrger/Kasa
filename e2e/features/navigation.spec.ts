import { test, expect } from '@playwright/test'
import { E2E_ORGS, E2E_FIXTURES } from '../seed'
import { ensureAlphaOrg, familyLink, clickSidebar } from '../helpers'

const NAV_ROUTES: Array<{ label: RegExp; path: RegExp; expectText?: RegExp }> = [
  { label: /^Dashboard$/i, path: /^\/$|\/dashboard/, expectText: /dashboard|families|members/i },
  { label: /^Families$/i, path: /\/families/, expectText: new RegExp(E2E_ORGS.alpha.markerFamily) },
  { label: /^Payments$/i, path: /\/payments/, expectText: /payment/i },
  { label: /^Tasks$/i, path: /\/tasks/, expectText: new RegExp(E2E_FIXTURES.taskTitle) },
  { label: /^Calculations$/i, path: /\/calculations/, expectText: /calculation|yearly|balance/i },
  { label: /^Events$/i, path: /\/events/, expectText: new RegExp(E2E_FIXTURES.eventTypeName) },
  { label: /^Dues calc$/i, path: /\/projections/, expectText: /dues|projection|payer/i },
  { label: /^Reports$/i, path: /\/reports/, expectText: /report|profit|loss|transaction/i },
  { label: /^Statements$/i, path: /\/statements/, expectText: /statement|tax receipt/i },
  { label: /^Settings$/i, path: /\/settings/, expectText: /settings|email configuration/i },
]

test.describe('primary navigation', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
    await page.goto('/')
  })

  for (const route of NAV_ROUTES) {
    test(`sidebar → ${route.label}`, async ({ page }) => {
      await clickSidebar(page, route.label)
      await expect(page).toHaveURL(route.path)
      if (route.expectText) {
        await expect(page.getByText(route.expectText).first()).toBeVisible({ timeout: 30_000 })
      }
    })
  }

  test('legacy redirects land in settings tabs', async ({ page }) => {
    await page.goto('/payment-plans')
    await expect(page).toHaveURL(/\/settings\?tab=paymentPlans/)
    await expect(page.getByRole('heading', { name: /payment plans/i })).toBeVisible()

    await page.goto('/lifecycle-event-types')
    await expect(page).toHaveURL(/\/settings\?tab=eventTypes/)
    await expect(page.getByRole('heading', { name: /lifecycle event types/i })).toBeVisible()
  })

  test('report builder page loads', async ({ page }) => {
    await page.goto('/reports/builder')
    await expect(page.getByRole('heading', { name: /report builder|custom report/i }).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  test('settings members sub-route loads', async ({ page }) => {
    await page.goto('/settings/members')
    await expect(page).toHaveURL(/\/settings\/members/)
  })
})
