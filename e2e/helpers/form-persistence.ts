import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { gotoFamilyDetail, inMain } from '../helpers'

/** Unique suffix for round-trip field values. */
export function uniqueTag(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}`
}

/** Input/textarea/select under a plain <label> (no htmlFor) inside a container. */
export function fieldUnderLabel(container: Locator, label: string | RegExp): Locator {
  return container
    .locator('label')
    .filter({ hasText: label })
    .first()
    .locator('..')
    .locator('input, textarea, select')
    .first()
}

export async function fillPlainLabelField(
  container: Locator,
  label: string | RegExp,
  value: string,
): Promise<void> {
  await fieldUnderLabel(container, label).fill(value)
}

/** Click-to-edit row under a section heading on family/member detail. */
export async function editInlineField(
  page: Page,
  sectionHeading: string,
  fieldLabel: string | RegExp,
  value: string,
  opts?: { selectValue?: string; memberApi?: boolean },
): Promise<void> {
  const section = inMain(page).locator('h4', { hasText: sectionHeading }).locator('..')
  const cell = section.locator('label', { hasText: fieldLabel }).locator('..')
  await cell.locator('[title="Click to edit"]').click()

  if (opts?.selectValue) {
    await cell.locator('select').selectOption(opts.selectValue)
    await cell.getByTitle('Save').click()
  } else {
    const input = cell.locator('input').first()
    await input.fill(value)
    await input.press('Enter')
  }

  const urlRe = opts?.memberApi ? /\/members\// : /\/families\//
  await page.waitForResponse(
    (r) => r.request().method() === 'PUT' && urlRe.test(r.url()) && r.ok(),
    { timeout: 60_000 },
  )
}

export async function gotoFamilyInfoTab(page: Page): Promise<void> {
  await gotoFamilyDetail(page)
}

export async function openFamilyEditModal(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /edit all/i }).click()
  const modal = page.locator('h2', { hasText: 'Edit Family Information' }).locator('..')
  await expect(modal).toBeVisible({ timeout: 30_000 })
  return modal
}

export async function waitForSettingsPanelReady(page: Page, readyLocator: Locator): Promise<void> {
  await expect(readyLocator).toBeVisible({ timeout: 120_000 })
}

/** Wait until the letterhead form is interactive (fetch finished, panel mounted). */
export async function waitForLetterheadLoaded(page: Page): Promise<void> {
  const saveBtn = page.getByRole('button', { name: 'Save letterhead' })
  await expect(saveBtn).toBeVisible({ timeout: 120_000 })
  await expect(saveBtn).toBeEnabled()
}
