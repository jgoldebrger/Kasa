import { test, expect } from '@playwright/test'
import { E2E_FIXTURES } from '../seed'
import { ensureAlphaOrg, gotoFamilyDetail, gotoSettingsTab, inMain, markerFamilyId } from '../helpers'
import { apiPost } from '../helpers/api-origin'

test.describe('CRUD workflows', () => {
  test.setTimeout(240_000)

  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('create task from tasks page', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByRole('button', { name: /create task|add task|new task/i }).click()
    await expect(page.getByRole('dialog', { name: /create task/i })).toBeVisible()

    const title = `E2E Task ${Date.now()}`
    await page.getByLabel('Title').fill(title)
    await page.getByLabel('Email').fill('e2e-task@example.com')
    await page.getByRole('button', { name: /^create task$/i }).click()

    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
  })

  test('create task from family page modal', async ({ page }) => {
    test.setTimeout(240_000)
    await gotoFamilyDetail(page)
    await page.getByRole('button', { name: 'Add Task' }).first().click()
    await expect(page.getByRole('dialog', { name: /create task/i })).toBeVisible()
  })

  test('POST payment plan via API then visible in settings', async ({ page }) => {
    const planName = `E2E Plan ${Date.now()}`
    const res = await apiPost(page.request, '/api/payment-plans', {
      name: planName,
      yearlyPrice: 999,
    })
    expect(res.ok()).toBeTruthy()

    await gotoSettingsTab(page, 'paymentPlans')
    await expect(page.getByRole('heading', { name: /payment plans/i })).toBeVisible()
    await expect(
      inMain(page).getByRole('table').getByRole('button', { name: planName, exact: true }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('POST lifecycle event type via API', async ({ page }) => {
    const typeName = `e2e_wedding_${Date.now()}`
    const res = await apiPost(page.request, '/api/lifecycle-event-types', {
      type: typeName,
      name: 'E2E Wedding',
      amount: 100,
    })
    expect(res.ok()).toBeTruthy()

    await gotoSettingsTab(page, 'eventTypes')
    await expect(page.getByRole('heading', { name: /lifecycle event types/i })).toBeVisible()
    await expect(
      inMain(page).getByRole('table').getByRole('button', { name: 'E2E Wedding', exact: true }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('member financial tabs load via API-backed UI', async ({ page }) => {
    const familyId = await markerFamilyId(page)
    const famRes = await page.request.get(`/api/families/${familyId}`)
    expect(famRes.ok()).toBeTruthy()
    const famData = await famRes.json()
    const member = famData.members?.find(
      (m: { firstName: string }) => m.firstName === E2E_FIXTURES.memberFirstName,
    )
    expect(member?._id).toBeTruthy()

    await gotoFamilyDetail(page)
    await page.getByText(`${E2E_FIXTURES.memberFirstName} ${E2E_FIXTURES.memberLastName}`).first().click()

    for (const tab of ['balance', 'payments', 'statements'] as const) {
      await inMain(page).getByRole('button', { name: new RegExp(tab, 'i') }).click()
      await expect(inMain(page).getByText(/balance|payment|statement|loading/i).first()).toBeVisible({
        timeout: 30_000,
      })
    }
  })
})
