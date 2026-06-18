import { test, expect } from '@playwright/test'
import { loginAsE2eMember } from './helpers'

test.describe('guest access', () => {
  test('protected routes redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/families')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login works with seeded credentials', async ({ page }) => {
    await loginAsE2eMember(page)
  })
})
