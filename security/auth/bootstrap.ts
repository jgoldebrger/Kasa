import fs from 'fs'

import path from 'path'

import type { BrowserContext, Page } from '@playwright/test'

import { expect } from '@playwright/test'

import { generateTotpCode } from '@/lib/totp'

import { E2E_TOTP_SECRET } from '../../e2e/seed'

import { getSecurityConfig, type SecurityCredentials } from '../config'

const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth')

export type AuthRole = 'owner' | 'member' | 'guest' | 'platform-admin'

export function authStoragePath(role: AuthRole): string {
  return path.join(AUTH_DIR, `${role}.json`)
}

export function ensureAuthDir(): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
}

/** Pre-accept cookie banner so it does not block login clicks. */

async function acceptCookieConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('kasa-cookie-consent', 'accepted')
  })
}

async function completeLoginAfterCredentials(page: Page): Promise<void> {
  const twoFactorInput = page.getByLabel(/two-factor authentication/i)

  const needs2fa = await twoFactorInput

    .waitFor({ state: 'visible', timeout: 15_000 })

    .then(() => true)

    .catch(() => false)

  if (needs2fa) {
    await twoFactorInput.fill(generateTotpCode(E2E_TOTP_SECRET))

    await page.getByRole('button', { name: /verify and sign in/i }).click()
  }

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 120_000 })
}

export async function loginViaUi(
  page: Page,

  credentials: SecurityCredentials,
): Promise<void> {
  const config = getSecurityConfig()

  const loginUrl = `${config.baseUrl}/login`

  let lastError: unknown

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await acceptCookieConsent(page)

      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })

      const signIn = page.getByRole('button', { name: 'Sign in' })

      await expect(signIn).toBeVisible({ timeout: 30_000 })

      await expect(signIn).toBeEnabled()

      await page.getByLabel('Email').fill(credentials.email)

      await page.getByLabel('Password').fill(credentials.password)

      await signIn.click()

      await completeLoginAfterCredentials(page)

      return
    } catch (err) {
      lastError = err

      if (attempt < 2) {
        await page.waitForTimeout(2_000)
      }
    }
  }

  throw lastError
}

export async function saveStorageState(context: BrowserContext, role: AuthRole): Promise<string> {
  ensureAuthDir()

  const file = authStoragePath(role)

  await context.storageState({ path: file })

  return file
}

export async function extractSessionArtifacts(page: Page): Promise<{
  cookies: Awaited<ReturnType<typeof page.context>>['cookies'] extends (
    ...args: infer _
  ) => Promise<infer R>
    ? R
    : never

  localStorage: Record<string, string>

  sessionStorage: Record<string, string>
}> {
  const cookies = await page.context().cookies()

  const storage = await page.evaluate(() => {
    const ls: Record<string, string> = {}

    const ss: Record<string, string> = {}

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)

      if (k) ls[k] = localStorage.getItem(k) ?? ''
    }

    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)

      if (k) ss[k] = sessionStorage.getItem(k) ?? ''
    }

    return { localStorage: ls, sessionStorage: ss }
  })

  return { cookies, localStorage: storage.localStorage, sessionStorage: storage.sessionStorage }
}

export function findSessionCookie(
  cookies: Array<{ name: string; value: string }>,
): { name: string; value: string } | undefined {
  return cookies.find(
    (c) =>
      c.name === 'authjs.session-token' ||
      c.name === '__Secure-authjs.session-token' ||
      c.name.includes('session-token'),
  )
}
