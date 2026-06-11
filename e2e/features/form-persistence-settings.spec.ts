import { test, expect } from '@playwright/test'
import { ensureAlphaOrg, gotoSettingsTab, inMain } from '../helpers'
import {
  fillPlainLabelField,
  uniqueTag,
  waitForLetterheadLoaded,
  waitForSettingsPanelReady,
} from '../helpers/form-persistence'

const LETTERHEAD_FIELDS: Array<{ label: string; apiKey: string; value: (tag: string) => string }> = [
  { label: 'Address line 1', apiKey: 'addressLine1', value: (t) => `${t} Main St` },
  { label: 'Address line 2', apiKey: 'addressLine2', value: (t) => `Suite ${t.slice(-4)}` },
  { label: 'City', apiKey: 'city', value: (t) => `City${t}` },
  { label: 'State / region', apiKey: 'state', value: () => 'NY' },
  { label: 'ZIP / postal code', apiKey: 'zip', value: () => '10001' },
  { label: 'Phone', apiKey: 'phone', value: () => '5551234567' },
  { label: 'Email', apiKey: 'email', value: (t) => `letterhead-${t}@example.com` },
  { label: 'Tax ID (EIN)', apiKey: 'taxId', value: (t) => `12-${t.slice(-7).padStart(7, '0')}` },
  { label: 'Thank-you note', apiKey: 'receiptThankYou', value: (t) => `Thank you ${t}` },
  {
    label: 'Tax-deductible disclosure',
    apiKey: 'taxDeductibleDisclosure',
    value: (t) => `Disclosure ${t}`,
  },
  { label: 'Signer name', apiKey: 'signatureName', value: (t) => `Signer ${t}` },
  { label: 'Signer title', apiKey: 'signatureTitle', value: () => 'Treasurer' },
  { label: 'Footer text (statements)', apiKey: 'statementFooter', value: (t) => `Footer ${t}` },
]

test.describe('Form persistence — settings', () => {
  test.setTimeout(240_000)

  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('letterhead fields save and display after reload', async ({ page }) => {
    const tag = uniqueTag('lh')
    await gotoSettingsTab(page, 'letterhead')
    const saveBtn = page.getByRole('button', { name: 'Save letterhead' })
    await waitForLetterheadLoaded(page)

    const form = page.locator('form').filter({ has: saveBtn })
    for (const field of LETTERHEAD_FIELDS) {
      await form.getByLabel(field.label).fill(field.value(tag))
    }

    const saveRes = page.waitForResponse(
      (r) => r.url().includes('/api/organizations/letterhead') && r.request().method() === 'PUT',
    )
    await saveBtn.click()
    expect((await saveRes).ok()).toBeTruthy()

    const getAfterSave = await page.request.get('/api/organizations/letterhead')
    const savedBody = await getAfterSave.json()
    const saved = savedBody.data ?? savedBody
    expect(saved[LETTERHEAD_FIELDS[0]!.apiKey]).toBe(LETTERHEAD_FIELDS[0]!.value(tag))

    await page.reload()
    await gotoSettingsTab(page, 'letterhead')
    await waitForLetterheadLoaded(page)

    for (const field of LETTERHEAD_FIELDS) {
      await expect(page.getByLabel(field.label)).toHaveValue(field.value(tag))
    }

    const get = await page.request.get('/api/organizations/letterhead')
    expect(get.ok()).toBeTruthy()
    const getBody = await get.json()
    const stored = getBody.data ?? getBody
    for (const field of LETTERHEAD_FIELDS) {
      expect(stored[field.apiKey]).toBe(field.value(tag))
    }
  })

  test('localization currency and locale save after reload', async ({ page }) => {
    await gotoSettingsTab(page, 'localization')
    await expect(page.getByRole('heading', { name: 'Localization' })).toBeVisible()

    try {
      await page.getByLabel('Currency').selectOption('ILS')
      await page.getByLabel('Display language / locale').selectOption('he-IL')

      const saveRes = page.waitForResponse(
        (r) =>
          r.url().includes('/api/organizations/current') && r.request().method() === 'PATCH',
      )
      await page.getByRole('button', { name: 'Save changes' }).click()
      expect((await saveRes).ok()).toBeTruthy()

      await page.reload()
      await expect(page.getByLabel('Currency')).toHaveValue('ILS', { timeout: 30_000 })
      await expect(page.getByLabel('Display language / locale')).toHaveValue('he-IL')

      const api = await page.request.get('/api/organizations/current')
      expect(api.ok()).toBeTruthy()
      const org = await api.json()
      expect(org.currency).toBe('ILS')
      expect(org.locale).toBe('he-IL')
    } finally {
      // Always restore defaults so later specs (navigation labels) stay English.
      await gotoSettingsTab(page, 'localization')
      await page.getByLabel('Currency').selectOption('USD')
      await page.getByLabel('Display language / locale').selectOption('en-US')
      const restoreRes = page.waitForResponse(
        (r) =>
          r.url().includes('/api/organizations/current') && r.request().method() === 'PATCH',
      )
      await page.getByRole('button', { name: 'Save changes' }).click()
      expect((await restoreRes).ok()).toBeTruthy()
    }
  })

  test('payment plan modal fields persist in table', async ({ page }) => {
    const tag = uniqueTag('plan')
    const planName = `E2E Plan ${tag}`
    await gotoSettingsTab(page, 'paymentPlans')
    await page.getByRole('button', { name: 'Add Payment Plan' }).click()
    const modal = page.getByRole('heading', { name: 'Add Payment Plan' }).locator('..')
    await fillPlainLabelField(modal, 'Plan Name *', planName)
    await fillPlainLabelField(modal, /Yearly Price/, '1234.56')
    const createRes = page.waitForResponse(
      (r) => r.url().includes('/api/payment-plans') && r.request().method() === 'POST',
    )
    await modal.getByRole('button', { name: 'Create' }).click()
    const res = await createRes
    expect(res.ok()).toBeTruthy()

    const listRes = await page.request.get('/api/payment-plans')
    expect(listRes.ok()).toBeTruthy()
    const plans = await listRes.json()
    const created = (Array.isArray(plans) ? plans : plans.plans ?? []).find(
      (p: { name: string }) => p.name === planName,
    )
    expect(created).toBeTruthy()

    await gotoSettingsTab(page, 'paymentPlans')
    const planBtn = inMain(page).getByRole('table').getByRole('button', { name: planName, exact: true })
    await planBtn.first().scrollIntoViewIfNeeded()
    await expect(planBtn.first()).toBeVisible({ timeout: 30_000 })

    await page.reload()
    await gotoSettingsTab(page, 'paymentPlans')
    const planBtnAfter = inMain(page).getByRole('table').getByRole('button', { name: planName, exact: true })
    await planBtnAfter.first().scrollIntoViewIfNeeded()
    await expect(planBtnAfter.first()).toBeVisible({ timeout: 30_000 })
  })

  test('lifecycle event type modal fields persist in table', async ({ page }) => {
    const tag = uniqueTag('evt')
    const typeCode = `e2e_${tag.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`
    const displayName = `E2E Event ${tag}`
    await gotoSettingsTab(page, 'eventTypes')
    await waitForSettingsPanelReady(page, page.getByRole('button', { name: 'Add Event Type' }))
    await page.getByRole('button', { name: 'Add Event Type' }).click()
    const modal = page.getByRole('heading', { name: 'Add Event Type' }).locator('..')
    await fillPlainLabelField(modal, 'Type Code *', typeCode)
    await fillPlainLabelField(modal, 'Name *', displayName)
    await fillPlainLabelField(modal, /Amount/, '42')
    const createRes = page.waitForResponse(
      (r) => r.url().includes('/api/lifecycle-event-types') && r.request().method() === 'POST',
    )
    await modal.getByRole('button', { name: 'Create' }).click()
    const res = await createRes
    expect(res.ok()).toBeTruthy()

    const typesRes = await page.request.get('/api/lifecycle-event-types')
    expect(typesRes.ok()).toBeTruthy()
    const types = await typesRes.json()
    const created = (Array.isArray(types) ? types : types.eventTypes ?? []).find(
      (t: { name: string }) => t.name === displayName,
    )
    expect(created).toBeTruthy()

    const typeBtn = inMain(page).getByRole('table').getByRole('button', { name: displayName, exact: true })
    await typeBtn.first().scrollIntoViewIfNeeded()
    await expect(typeBtn.first()).toBeVisible({ timeout: 30_000 })

    await page.reload()
    await gotoSettingsTab(page, 'eventTypes')
    const typeBtnAfter = inMain(page).getByRole('table').getByRole('button', { name: displayName, exact: true })
    await typeBtnAfter.first().scrollIntoViewIfNeeded()
    await expect(typeBtnAfter.first()).toBeVisible({ timeout: 30_000 })
  })
})
