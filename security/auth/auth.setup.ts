import { test as setup } from '@playwright/test'
import { bootstrapAuthRole } from '../playwright/fixtures'

setup('bootstrap owner session', async ({ page }) => {
  await bootstrapAuthRole(page, 'owner')
})

setup('bootstrap member session', async ({ page }) => {
  await bootstrapAuthRole(page, 'member')
})

setup('bootstrap guest (no session)', async () => {
  /* guest uses empty context — no storage state file */
})
