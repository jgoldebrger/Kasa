import { test, expect } from '@playwright/test'
import { ensureAlphaOrg } from './helpers'

const BULK_FAMILIES = Number(process.env.E2E_BULK_FAMILIES || '1100')

test.describe('large org lists', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })
  test('GET /api/families returns more than 1000 rows for Alpha org', async ({ page }) => {
    await page.goto('/families')
    await expect(page).not.toHaveURL(/\/login/)

    const res = await page.request.get('/api/families')
    expect(res.ok()).toBe(true)

    const families = await res.json()
    expect(Array.isArray(families)).toBe(true)
    expect(families.length).toBeGreaterThan(BULK_FAMILIES)
    expect(families.some((f: { name?: string }) => f.name === 'Alpha Marker Family')).toBe(true)
  })

  test('GET /api/statements legacy path is an array (pagination wired server-side)', async ({
    page,
  }) => {
    const res = await page.request.get('/api/statements')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
