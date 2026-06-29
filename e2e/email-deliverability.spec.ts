import { test, expect, type Page } from '@playwright/test'
import { ensureAlphaOrg, gotoSettingsTab, markerFamilyId } from './helpers'

const CHECKLIST_LABELS = [
  /SMTP configured/i,
  /SMTP verified recently/i,
  /Reply-to address/i,
  /Physical mailing address/i,
  /Daily send quota/i,
] as const

const DELIVERABILITY_FAIL = {
  smtpConfigured: { status: 'fail', ok: false },
  smtpVerifiedRecently: { status: 'fail', ok: false },
  replyToSet: { status: 'warn', ok: false },
  physicalAddressSet: { status: 'fail', ok: false },
  quotaHeadroom: { status: 'pass', ok: true },
  quota: { sentToday: 0, limit: 500, remaining: 500 },
} as const

/** Stub GET /api/email-config so Settings shows an active SMTP configuration. */
async function stubConfiguredEmail(page: Page): Promise<void> {
  await page.route('**/api/email-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        email: 'e2e@kasa.test',
        fromName: 'E2E Org Alpha',
        replyTo: 'office@example.com',
        lastTestAt: new Date().toISOString(),
        lastTestStatus: 'success',
      }),
    })
  })
}

/** Stub POST /api/email-config/test — no real SMTP in CI. */
async function stubSmtpTestSuccess(page: Page): Promise<void> {
  await page.route('**/api/email-config/test', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Test email sent successfully', sent: true }),
    })
  })
}

async function stubDeliverability(page: Page, body: object): Promise<void> {
  await page.route('**/api/emails/deliverability-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

async function gotoCommunicationsCompose(page: Page): Promise<void> {
  const familyId = await markerFamilyId(page)
  const familiesLoaded = page.waitForResponse(
    (r) => r.url().includes('/api/families') && r.request().method() === 'GET' && r.ok(),
    { timeout: 60_000 },
  )
  await page.goto(`/communications?familyId=${familyId}`, { timeout: 180_000 })
  await expect(page).not.toHaveURL(/\/login/)
  await familiesLoaded
  await expect(page.getByRole('checkbox', { name: /Alpha Marker/i })).toBeVisible({
    timeout: 60_000,
  })
}

async function fillComposeFields(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('E2E deliverability gate')
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type('E2E test body for deliverability')
}

test.describe('email deliverability', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('deliverability checklist visible in Settings Email panel', async ({ page }) => {
    const statusLoaded = page.waitForResponse(
      (r) => r.url().includes('/api/emails/deliverability-status') && r.ok(),
    )
    await gotoSettingsTab(page)
    await statusLoaded

    await expect(page.getByRole('heading', { name: /email configuration/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /deliverability checklist/i })).toBeVisible()
    await expect(page.getByText(/loading checklist/i)).toBeHidden({ timeout: 30_000 })

    for (const label of CHECKLIST_LABELS) {
      await expect(page.getByText(label).first()).toBeVisible()
    }

    await expect(page.getByText(/OK|Attention|Action needed/).first()).toBeVisible()
  })

  test('send test email shows success when SMTP test API succeeds', async ({ page }) => {
    await stubConfiguredEmail(page)
    await stubSmtpTestSuccess(page)

    await gotoSettingsTab(page)
    await expect(page.getByRole('button', { name: /send test email/i })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: /send test email/i }).click()
    await expect(page.getByText(/test email sent successfully/i)).toBeVisible({
      timeout: 15_000,
    })
  })

  test('send test email button hidden when email is not configured', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: /email configuration/i })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByRole('button', { name: /send test email/i })).not.toBeVisible()
  })

  test('compose send blocked by checklist failures; Send anyway proceeds', async ({ page }) => {
    let bulkSendCalled = false

    await stubDeliverability(page, DELIVERABILITY_FAIL)
    await page.route('**/api/emails/send-bulk', async (route) => {
      bulkSendCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: 1, failed: 0 }),
      })
    })

    await gotoCommunicationsCompose(page)
    await fillComposeFields(page)
    await page.getByRole('checkbox', { name: /Alpha Marker Family/i }).check()

    const sendButton = page.getByRole('button', { name: /send to 1 famil/i })
    await sendButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/deliverability issues detected/i)).toBeVisible()
    await dialog.getByRole('button', { name: /^cancel$/i }).click()
    await expect(dialog).toBeHidden()
    expect(bulkSendCalled).toBe(false)

    await sendButton.click()
    await expect(dialog.getByText(/deliverability issues detected/i)).toBeVisible()
    await dialog.getByRole('button', { name: /send anyway/i }).click()

    await expect.poll(() => bulkSendCalled).toBe(true)
  })
})
