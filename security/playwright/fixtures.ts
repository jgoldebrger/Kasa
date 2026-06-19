import { test as base, expect } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { getSecurityConfig } from '../config'
import {
  authStoragePath,
  ensureAuthDir,
  loginViaUi,
  saveStorageState,
  type AuthRole,
} from '../auth'
import { attachTrafficCapture, snapshotSession } from '../helpers/capture'
import { playwrightLaunchOptions } from '../helpers/proxy'
import { recordFinding } from '../reports/writer'
import { findingFromTest } from '../reports/types'

type SecurityFixtures = {
  secConfig: ReturnType<typeof getSecurityConfig>
  authedPage: Page
  ownerContext: BrowserContext
  memberContext: BrowserContext
  guestContext: BrowserContext
  guestRequest: APIRequestContext
  recordSecFinding: typeof recordFinding
}

export const test = base.extend<SecurityFixtures>({
  secConfig: async ({}, use) => {
    await use(getSecurityConfig())
  },

  recordSecFinding: async ({}, use) => {
    await use(recordFinding)
  },

  authedPage: async ({ browser, secConfig }, use) => {
    const launchOpts = playwrightLaunchOptions()
    const context = await browser.newContext({
      storageState: authStoragePath('owner'),
      ignoreHTTPSErrors: launchOpts.ignoreHTTPSErrors,
      baseURL: secConfig.baseUrl,
      recordHar: secConfig.captureHar
        ? { path: `security/reports/output/har-${Date.now()}.har` }
        : undefined,
    })
    const page = await context.newPage()
    attachTrafficCapture(page)
    await use(page)
    await snapshotSession(page)
    await context.close()
  },

  ownerContext: async ({ browser, secConfig }, use) => {
    const launchOpts = playwrightLaunchOptions()
    const context = await browser.newContext({
      storageState: authStoragePath('owner'),
      ignoreHTTPSErrors: launchOpts.ignoreHTTPSErrors,
      baseURL: secConfig.baseUrl,
    })
    await use(context)
    await context.close()
  },

  memberContext: async ({ browser, secConfig }, use) => {
    const launchOpts = playwrightLaunchOptions()
    const context = await browser.newContext({
      storageState: authStoragePath('member'),
      ignoreHTTPSErrors: launchOpts.ignoreHTTPSErrors,
      baseURL: secConfig.baseUrl,
    })
    await use(context)
    await context.close()
  },

  guestContext: async ({ browser, secConfig }, use) => {
    const launchOpts = playwrightLaunchOptions()
    const context = await browser.newContext({
      ignoreHTTPSErrors: launchOpts.ignoreHTTPSErrors,
      baseURL: secConfig.baseUrl,
    })
    await use(context)
    await context.close()
  },

  guestRequest: async ({ guestContext }, use) => {
    await use(guestContext.request)
  },
})

export { expect }

export function assertSecurityPassed(
  title: string,
  category: string,
  passed: boolean,
  detail: string,
  severity?: 'critical' | 'high' | 'medium' | 'low',
): void {
  recordFinding(findingFromTest({ title, category, passed, detail, severity }))
  expect(passed, detail).toBeTruthy()
}

export async function bootstrapAuthRole(page: Page, role: AuthRole): Promise<void> {
  const config = getSecurityConfig()
  ensureAuthDir()
  if (role === 'guest') return

  const creds =
    role === 'owner'
      ? config.owner
      : role === 'member'
        ? config.member
        : (config.platformAdmin ?? config.owner)

  await loginViaUi(page, creds)
  await saveStorageState(page.context(), role)
}
