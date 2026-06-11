import { test, expect } from '@playwright/test'
import { ensureAlphaOrg, gotoSettingsTab } from '../helpers'

const SETTINGS_TABS: Array<{ tab?: string; heading: RegExp }> = [
  { heading: /email configuration/i },
  { tab: 'eventTypes', heading: /lifecycle event types/i },
  { tab: 'paymentPlans', heading: /payment plans/i },
  { tab: 'automation', heading: /automation/i },
  { tab: 'kevittel', heading: /print|kevittel|hebrew/i },
  { tab: 'cycle', heading: /cycle configuration/i },
  { tab: 'branding', heading: /organization logo/i },
  { tab: 'labels', heading: /mail labels/i },
  { tab: 'localization', heading: /localization/i },
  { tab: 'letterhead', heading: /letterhead/i },
  { tab: 'activity', heading: /activity log/i },
  { tab: 'members', heading: /members|invite|pending invites/i },
  { tab: 'trash', heading: /recycle bin|trash|empty/i },
]

test.describe('settings tabs', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  for (const { tab, heading } of SETTINGS_TABS) {
    test(`tab ${tab ?? 'email'} renders`, async ({ page }) => {
      await gotoSettingsTab(page, tab)
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
        timeout: 45_000,
      })
    })
  }
})
