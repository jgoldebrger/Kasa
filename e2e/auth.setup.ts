import { mkdirSync } from 'fs'
import path from 'path'
import { test as setup } from '@playwright/test'
import { loginAsE2eUser } from './helpers'

const authFile = path.join(__dirname, '.auth', 'user.json')

setup('authenticate test user', async ({ page }) => {
  await loginAsE2eUser(page)

  mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})
