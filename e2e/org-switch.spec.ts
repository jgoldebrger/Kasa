import { test, expect } from '@playwright/test'
import { E2E_ORGS } from './seed'
import { ensureAlphaOrg, familyLink } from './helpers'

test.describe('org switch', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('shows org-scoped families after switching workspaces', async ({ page }) => {
    await page.goto('/families')

    await expect(familyLink(page, E2E_ORGS.alpha.markerFamily)).toBeVisible({ timeout: 30_000 })
    await expect(familyLink(page, E2E_ORGS.beta.markerFamily)).not.toBeVisible()

    // Open org switcher (shows active org name once org list has loaded).
    const switcher = page.getByRole('button', { name: new RegExp(E2E_ORGS.alpha.name) })
    await expect(switcher).toBeVisible({ timeout: 30_000 })
    await switcher.click()
    await page.getByRole('button', { name: E2E_ORGS.beta.name }).click()

    await expect(page.getByText(`Switched to ${E2E_ORGS.beta.name}`)).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(E2E_ORGS.beta.name) })).toBeVisible()

    await page.goto('/families')
    await expect(familyLink(page, E2E_ORGS.beta.markerFamily)).toBeVisible({ timeout: 30_000 })
    await expect(familyLink(page, E2E_ORGS.alpha.markerFamily)).not.toBeVisible()
  })
})
