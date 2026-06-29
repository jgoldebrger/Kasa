import { test, expect, type Page } from '@playwright/test'
import { E2E_ORGS } from './seed'
import { ensureAlphaOrg, exitSupportModeIfActive, supportModeBanner } from './helpers'

const SUPPORT_REASON = 'E2E support access test'

/** Complete the support-mode enter modal (reason required, min 3 chars). */
async function confirmSupportModeEnter(page: Page, reason: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('heading', { name: /enter support mode/i })).toBeVisible()

  const readOnlyCheckbox = dialog.getByRole('checkbox', { name: /read-only/i })
  if (await readOnlyCheckbox.isVisible().catch(() => false)) {
    await expect(readOnlyCheckbox).toBeVisible()
  }

  await dialog.locator('textarea').fill(reason)
  await dialog.getByRole('button', { name: /enter support mode/i }).click()
}

/** Mark org setup complete so post-impersonate routes use the app shell (not /setup). */
async function ensureOrgSetupComplete(page: Page, orgName: string): Promise<void> {
  const res = await page.request.get('/api/admin/organizations')
  if (!res.ok()) return
  const data = (await res.json()) as {
    organizations?: Array<{ id: string; name: string; setupCompletedAt?: string | null }>
  }
  const org = data.organizations?.find((o) => o.name === orgName)
  if (!org?.id || org.setupCompletedAt) return
  await page.request.post(`/api/admin/organizations/${org.id}/mark-setup-complete`)
}

test.describe('platform admin support mode', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
    await exitSupportModeIfActive(page)
    await ensureOrgSetupComplete(page, E2E_ORGS.alpha.name)
  })

  test.afterEach(async ({ page }) => {
    await exitSupportModeIfActive(page)
  })

  test('enter support mode, banner persists across navigation, exit without reload', async ({
    page,
  }) => {
    await page.goto('/admin/organizations', { timeout: 180_000 })
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: /^organizations$/i })).toBeVisible({
      timeout: 30_000,
    })

    const targetOrg = E2E_ORGS.alpha
    const orgRow = page.getByRole('row').filter({ hasText: targetOrg.name })
    await expect(orgRow).toBeVisible({ timeout: 30_000 })
    await orgRow.getByRole('button', { name: 'Open as admin' }).click()

    await confirmSupportModeEnter(page, SUPPORT_REASON)

    await page.waitForURL((url) => !url.pathname.includes('/admin/organizations'), {
      timeout: 30_000,
    })

    const banner = supportModeBanner(page)
    await page.goto('/families')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText(targetOrg.name)

    await page.goto('/payments')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(targetOrg.name)

    await banner.getByRole('button', { name: /exit support mode/i }).click()
    await expect(banner).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(/exited support mode/i)).toBeVisible()
  })
})
