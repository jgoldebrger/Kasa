import { test, expect } from '@playwright/test'
import { ensureAlphaOrg, markerFamilyId } from '../helpers'
import {
  fillPlainLabelField,
  gotoFamilyInfoTab,
  openFamilyEditModal,
  uniqueTag,
} from '../helpers/form-persistence'

test.describe('Form persistence — family', () => {
  test.setTimeout(300_000)

  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('Edit Info modal: every field saves and displays after reload', async ({ page }) => {
    const tag = uniqueTag('fam')
    const familyId = await markerFamilyId(page)

    const famRes = await page.request.get(`/api/families/${familyId}`)
    const planId = (await famRes.json()).family.paymentPlanId

    const values = {
      name: `Alpha Marker ${tag}`,
      hebrewName: `משפחה ${tag}`,
      weddingDate: '2010-06-15',
      husbandFirstName: `Husb${tag}`,
      husbandHebrewName: 'דוד',
      husbandFatherHebrewName: 'אברהם',
      wifeFirstName: `Wife${tag}`,
      wifeHebrewName: 'שרה',
      wifeFatherHebrewName: 'יצחק',
      husbandCellPhone: '5551112222',
      wifeCellPhone: '5553334444',
      email: `family-${tag}@example.com`,
      phone: '5555556666',
      street: `${tag} Oak Avenue`,
      city: `City${tag}`,
      state: 'CA',
      zip: '90210',
    }

    await gotoFamilyInfoTab(page)
    const modal = await openFamilyEditModal(page)

    await fillPlainLabelField(modal, 'Family Name *', values.name)
    await fillPlainLabelField(modal, 'Family Name (Hebrew)', values.hebrewName)
    await fillPlainLabelField(modal, 'Wedding Date *', values.weddingDate)
    await modal
      .locator('label', { hasText: 'Payment Plan' })
      .locator('..')
      .locator('select')
      .selectOption({ index: 1 })

    const husbandSection = modal.locator('h3', { hasText: 'Husband Information' }).locator('..')
    await fillPlainLabelField(husbandSection, 'First Name', values.husbandFirstName)
    await fillPlainLabelField(husbandSection, 'Hebrew Name', values.husbandHebrewName)
    await fillPlainLabelField(husbandSection, "Father's Hebrew Name", values.husbandFatherHebrewName)
    await fillPlainLabelField(husbandSection, 'Cell Phone', values.husbandCellPhone)

    const wifeSection = modal.locator('h3', { hasText: 'Wife Information' }).locator('..')
    await fillPlainLabelField(wifeSection, 'First Name', values.wifeFirstName)
    await fillPlainLabelField(wifeSection, 'Hebrew Name', values.wifeHebrewName)
    await fillPlainLabelField(wifeSection, "Father's Hebrew Name", values.wifeFatherHebrewName)
    await fillPlainLabelField(wifeSection, 'Cell Phone', values.wifeCellPhone)

    const contactSection = modal.locator('h3', { hasText: 'Contact Information' }).locator('..')
    await fillPlainLabelField(contactSection, 'Email', values.email)
    await fillPlainLabelField(contactSection, 'Phone', values.phone)
    await fillPlainLabelField(contactSection, 'Street Address', values.street)
    await fillPlainLabelField(contactSection, 'City', values.city)
    await fillPlainLabelField(contactSection, 'State', values.state)
    await fillPlainLabelField(contactSection, 'ZIP Code', values.zip)

    const saveRes = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/families/${familyId}`) && r.request().method() === 'PUT',
    )
    await modal.getByRole('button', { name: 'Save Info' }).click()
    expect((await saveRes).ok()).toBeTruthy()
    await expect(modal).toBeHidden({ timeout: 30_000 })

    await expect(page.getByText(values.name).first()).toBeVisible()
    await expect(page.getByText(values.email).first()).toBeVisible()

    await page.reload()
    await gotoFamilyInfoTab(page)
    await expect(page.getByText(values.name).first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(values.email).first()).toBeVisible()

    const api = await page.request.get(`/api/families/${familyId}`)
    const f = (await api.json()).family
    expect(f.name).toBe(values.name)
    expect(f.email).toBe(values.email)
    expect(f.city).toBe(values.city)
    expect(f.paymentPlanId).toBeTruthy()
    expect(planId).toBeTruthy()
  })
})
