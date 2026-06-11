import { test, expect } from '@playwright/test'
import { E2E_USER, E2E_ORGS, E2E_FIXTURES } from '../seed'
import { ensureAlphaOrg, openGlobalSearch, familyLink } from '../helpers'

test.describe('account & public pages', () => {
  test('account page shows profile and 2FA section', async ({ page }) => {
    await ensureAlphaOrg(page)
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: /your account|account|profile/i }).first()).toBeVisible()
    await expect(page.getByText(E2E_USER.email)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/two-factor|2fa|authenticator/i).first()).toBeVisible()
  })

  test('welcome page is public', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('link', { name: /sign in|log in|get started/i }).first()).toBeVisible()
  })
})

test.describe('search & notifications', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
    await page.goto('/')
  })

  test('global search finds marker family', async ({ page }) => {
    await openGlobalSearch(page, 'Alpha Marker')
    await expect(page.getByRole('option', { name: /alpha marker family/i }).or(
      page.getByText(/alpha marker family/i),
    ).first()).toBeVisible({ timeout: 15_000 })
  })

  test('notifications bell opens panel', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notification/i })
    await expect(bell).toBeVisible()
    await bell.click()
    await expect(page.getByText(/notification|no notifications|mark.*read/i).first()).toBeVisible()
  })
})

test.describe('platform admin', () => {
  test('invite requests admin accessible for platform admin', async ({ page }) => {
    await ensureAlphaOrg(page)

    const res = await page.request.get('/api/admin/invite-requests?status=pending')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(
      body.requests?.some((r: { email: string }) => r.email === E2E_FIXTURES.inviteRequestEmail),
    ).toBe(true)

    await page.goto('/admin/invite-requests', { timeout: 180_000 })
    await expect(page).not.toHaveURL(/\/login/)
  })
})
