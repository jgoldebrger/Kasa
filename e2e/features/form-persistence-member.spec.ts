import { test, expect } from '@playwright/test'
import { E2E_FIXTURES } from '../seed'
import { ensureAlphaOrg, gotoFamilyDetail, inMain } from '../helpers'
import { editInlineField, uniqueTag } from '../helpers/form-persistence'

const MEMBER_NAME = `${E2E_FIXTURES.memberFirstName} ${E2E_FIXTURES.memberLastName}`

test.describe('Form persistence — family member', () => {
  test.setTimeout(300_000)

  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('inline member fields save and display after reload', async ({ page }) => {
    const tag = uniqueTag('mem')

    await gotoFamilyDetail(page)
    await inMain(page).getByRole('button', { name: /^members$/i }).click()
    await expect(inMain(page).getByText(MEMBER_NAME).first()).toBeVisible({ timeout: 60_000 })
    await inMain(page).getByText(MEMBER_NAME).first().click()
    await expect(inMain(page).getByText(/Details/i).first()).toBeVisible({ timeout: 60_000 })

    const fields: Array<{
      section: string
      label: string | RegExp
      value: string
      selectValue?: string
    }> = [
      { section: 'Birth Information', label: 'Birth Date', value: '2000-01-15' },
      { section: 'Basic Information', label: 'First Name', value: `E2e${tag}` },
      { section: 'Basic Information', label: 'Last Name', value: `Last${tag}` },
      { section: 'Basic Information', label: 'First Name (Hebrew)', value: 'משה' },
      { section: 'Basic Information', label: 'Last Name (Hebrew)', value: 'כהן' },
      {
        section: 'Basic Information',
        label: 'Gender',
        value: 'male',
        selectValue: 'male',
      },
      { section: 'Marriage Information', label: 'Phone', value: '5559876543' },
      { section: 'Marriage Information', label: 'Email', value: `member-${tag}@example.com` },
      { section: 'Marriage Information', label: 'Spouse First Name', value: `Spouse${tag}` },
    ]

    for (const field of fields) {
      await editInlineField(page, field.section, field.label, field.value, {
        selectValue: field.selectValue,
        memberApi: true,
      })
    }

    const displayName = `E2e${tag} Last${tag}`
    await page.reload()
    await gotoFamilyDetail(page)
    await inMain(page).getByRole('button', { name: /^members$/i }).click()
    await inMain(page).getByText(displayName).first().click()
    await expect(inMain(page).getByText(`member-${tag}@example.com`).first()).toBeVisible({
      timeout: 60_000,
    })
  })
})
