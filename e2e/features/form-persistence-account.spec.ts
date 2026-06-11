import { test, expect } from '@playwright/test'
import { uniqueTag } from '../helpers/form-persistence'

test.describe('Form persistence — account', () => {
  test('profile name saves and displays after reload', async ({ page }) => {
    const newName = `E2E User ${uniqueTag('acct')}`
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()

    const nameInput = page.getByLabel('Name')
    await expect(nameInput).toBeVisible({ timeout: 30_000 })
    await nameInput.fill(newName)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/profile updated/i).first()).toBeVisible({ timeout: 15_000 })

    await page.reload()
    await expect(page.getByLabel('Name')).toHaveValue(newName, { timeout: 30_000 })

    const api = await page.request.get('/api/user')
    expect(api.ok()).toBeTruthy()
    const profile = await api.json()
    expect(profile.name).toBe(newName)
  })
})
