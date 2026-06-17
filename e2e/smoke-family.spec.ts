import { test, expect } from '@playwright/test'
import { E2E_ORGS } from './seed'
import { ensureAlphaOrg, familyLink, inMain } from './helpers'

test.describe('families smoke', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('families list loads for seeded owner with marker family', async ({ page }) => {
    await page.goto('/families')

    await expect(page).not.toHaveURL(/\/login/)
    await expect(inMain(page).getByRole('heading', { level: 1, name: /^Families$/i })).toBeVisible({
      timeout: 30_000,
    })

    await expect(familyLink(page, E2E_ORGS.alpha.markerFamily)).toBeVisible({ timeout: 30_000 })
  })
})
