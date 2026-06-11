import { mkdirSync } from 'fs'
import path from 'path'
import { test as setup, expect } from '@playwright/test'
import { generateTotpCode } from '../lib/totp'
import { E2E_USER, E2E_TOTP_SECRET } from './seed'
import { acceptCookieConsent } from './helpers'

const authFile = path.join(__dirname, '.auth', 'user.json')

setup('authenticate test user', async ({ page }) => {
  await acceptCookieConsent(page)
  await page.goto('/login')
  await page.getByLabel('Email').fill(E2E_USER.email)
  await page.getByLabel('Password').fill(E2E_USER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const twoFactorInput = page.getByLabel(/two-factor authentication/i)
  await expect(twoFactorInput).toBeVisible({ timeout: 60_000 })
  await twoFactorInput.fill(generateTotpCode(E2E_TOTP_SECRET))
  await page.getByRole('button', { name: /verify and sign in/i }).click()

  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 })

  mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})
