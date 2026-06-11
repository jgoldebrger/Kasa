import { test, expect } from '@playwright/test'
import { E2E_USER } from './seed'
import { acceptCookieConsent } from './helpers'

test.describe('guest access', () => {
  test('protected routes redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/families')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login works with seeded credentials', async ({ page }) => {
    await acceptCookieConsent(page)
    await page.goto('/login')
    await page.getByLabel('Email').fill(E2E_USER.email)
    await page.getByLabel('Password').fill(E2E_USER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
  })
})
