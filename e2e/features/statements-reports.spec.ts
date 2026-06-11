import { test, expect } from '@playwright/test'
import { ensureAlphaOrg } from '../helpers'

test.describe('statements & reports', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('statements tab and tax receipts tab', async ({ page }) => {
    await page.goto('/statements')
    await expect(page.getByRole('tab', { name: /statements/i })).toBeVisible()
    await expect(page.getByText(/last month/i).first()).toBeVisible()

    await page.getByRole('tab', { name: /tax receipts/i }).click()
    await expect(page.getByText(/tax receipt|year|membership dues/i).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  test('P&L report generates for current year', async ({ page }) => {
    await page.goto('/reports')
    await page.getByRole('button', { name: /generate|run report/i }).click()
    await expect(page.getByText(/transaction|income|expense|net/i).first()).toBeVisible({
      timeout: 45_000,
    })
  })

  test('projections / dues calculator loads multi-year table', async ({ page }) => {
    await page.goto('/projections')
    await expect(page.getByText(/dues|projection|payer|year/i).first()).toBeVisible({
      timeout: 45_000,
    })
  })

  test('report builder runs a saved-style query', async ({ page }) => {
    await page.goto('/reports/builder')
    await expect(page.getByRole('button', { name: /run|generate/i }).first()).toBeVisible()
    await page.getByRole('button', { name: /run|generate/i }).first().click()
    await expect(page.getByText(/result|row|total|count/i).first()).toBeVisible({ timeout: 45_000 })
  })
})
