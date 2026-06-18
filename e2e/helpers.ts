import type { Page, APIResponse } from '@playwright/test'
import { expect } from '@playwright/test'
import { E2E_ORGS, E2E_USER, E2E_MEMBER, E2E_TOTP_SECRET } from './seed'
import { generateTotpCode } from '../lib/totp'
import { apiMutationHeaders } from './helpers/api-origin'

/** Pre-accept cookie banner so it does not block login clicks in E2E. */
export async function acceptCookieConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('kasa-cookie-consent', 'accepted')
  })
}

/** Sign in via the login UI (optional TOTP when the account has 2FA). */
export async function loginViaUi(
  page: Page,
  credentials: { email: string; password: string },
  totpSecret?: string,
): Promise<void> {
  await acceptCookieConsent(page)
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password').fill(credentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const twoFactorInput = page.getByLabel(/two-factor authentication/i)
  const needs2fa = await twoFactorInput
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)

  if (needs2fa) {
    if (!totpSecret) {
      throw new Error(`Account ${credentials.email} requires 2FA but no TOTP secret was provided`)
    }
    await twoFactorInput.fill(generateTotpCode(totpSecret))
    await page.getByRole('button', { name: /verify and sign in/i }).click()
  }

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 })
}

/** Full login flow for the seeded owner (password + TOTP). */
export async function loginAsE2eUser(page: Page): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await loginViaUi(page, E2E_USER, E2E_TOTP_SECRET)
      return
    } catch (err) {
      lastError = err
      if (attempt < 2 && !page.isClosed()) {
        await page.waitForTimeout(2_000)
      }
    }
  }
  throw lastError
}

/** Login as the seeded member (no 2FA) — used by guest smoke tests. */
export async function loginAsE2eMember(page: Page): Promise<void> {
  await loginViaUi(page, E2E_MEMBER)
}

/** Activate an org via API (uses session cookies from the page context). */
export async function activateOrg(page: Page, orgName: string): Promise<void> {
  const res = await page.request.get('/api/organizations')
  if (!res.ok()) throw new Error(`Failed to load orgs: ${res.status()}`)
  const data = await res.json()
  const org = (data.organizations || []).find((o: { name: string }) => o.name === orgName)
  if (!org?.id) throw new Error(`Org not found: ${orgName}`)
  if (data.activeOrgId === org.id) return

  const patch = await page.request.patch('/api/organizations', {
    data: { activeOrgId: org.id },
    headers: apiMutationHeaders('/'),
  })
  if (!patch.ok()) throw new Error(`Failed to switch org: ${patch.status()}`)

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('kasa:org-changed'))
  })
}

export async function ensureAlphaOrg(page: Page): Promise<void> {
  await activateOrg(page, E2E_ORGS.alpha.name)
}

export function familyLink(page: Page, familyName: string) {
  return page.getByRole('link', { name: familyName }).first()
}

export async function gotoSettingsTab(page: Page, tab?: string): Promise<void> {
  const path = tab ? `/settings?tab=${tab}` : '/settings'
  await page.goto(path)
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({ timeout: 30_000 })
  if (tab) {
    await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}`))
    const panelHeading: Record<string, RegExp> = {
      paymentPlans: /^payment plans$/i,
      eventTypes: /lifecycle event types|event types/i,
      letterhead: /^letterhead$/i,
      localization: /^localization$/i,
    }
    const heading = panelHeading[tab]
    if (heading) {
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
        timeout: 60_000,
      })
    }
  }
}

export async function markerFamilyId(page: Page): Promise<string> {
  const q = encodeURIComponent('Alpha Marker')
  const res = await page.request.get(`/api/search?q=${q}`)
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as {
    items?: Array<{ type: string; id: string; label: string }>
  }
  const hit = body.items?.find((i) => i.type === 'family' && /alpha marker/i.test(i.label))
  if (!hit?.id) throw new Error('Marker family not found via search API')
  return hit.id
}

/** Open marker family detail (direct URL — reliable under load / i18n). */
export async function gotoFamilyDetail(page: Page): Promise<void> {
  const id = await markerFamilyId(page)
  const familyApi = page.waitForResponse(
    (r) => r.url().includes(`/api/families/${id}`) && r.request().method() === 'GET' && r.ok(),
    { timeout: 180_000 },
  )
  await page.goto(`/families/${id}?tab=info`, {
    waitUntil: 'domcontentloaded',
    timeout: 180_000,
  })
  await expect(page).not.toHaveURL(/\/login/)
  await familyApi
  const main = inMain(page)
  await expect(main.getByRole('heading', { level: 1, name: /Alpha Marker/i })).toBeVisible({
    timeout: 180_000,
  })
  await expect(main.getByRole('button', { name: 'Edit Info' })).toBeVisible({ timeout: 60_000 })
}

/** Navigate to a family detail tab and wait for the page shell to render. */
export async function gotoFamilyTab(page: Page, tab: string): Promise<void> {
  const id = await markerFamilyId(page)
  if (tab === 'info') {
    await gotoFamilyDetail(page)
    return
  }
  await page.goto(`/families/${id}?tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByText(/Alpha Marker/i).first()).toBeVisible({ timeout: 180_000 })
}

export async function apiOk(page: Page, path: string): Promise<APIResponse> {
  const res = await page.request.get(path)
  expect(res.ok(), `${path} returned ${res.status()}`).toBeTruthy()
  return res
}

export async function clickSidebar(page: Page, label: string | RegExp): Promise<void> {
  const link = page
    .getByRole('complementary', { name: 'Primary navigation' })
    .getByRole('link', { name: label })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.click()
  await page.waitForLoadState('domcontentloaded')
}

/** Locator scoped to `<main>` that ignores hidden responsive duplicates. */
export function inMain(page: Page) {
  return page.locator('main')
}

export async function openGlobalSearch(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder(/search/i)
  await expect(input).toBeVisible()
  await input.fill(query)
}
