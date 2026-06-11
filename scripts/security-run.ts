#!/usr/bin/env npx tsx
/**
 * Run security Playwright suite with optional env overrides.
 *
 *   npx tsx scripts/security-run.ts
 *   npx tsx scripts/security-run.ts --safe
 *   npx tsx scripts/security-run.ts --guest
 *   npx tsx scripts/security-run.ts --ui
 */
import { spawnSync } from 'child_process'

const args = process.argv.slice(2)
const safe = args.includes('--safe')
const guest = args.includes('--guest')
const ui = args.includes('--ui')

if (safe) process.env.SECURITY_ALLOW_DESTRUCTIVE = 'false'

const playwrightArgs = ['playwright', 'test', '-c', 'security/playwright.config.ts']
if (guest) playwrightArgs.push('--project=sec-guest')
if (ui) playwrightArgs.push('--ui')

const result = spawnSync('npx', playwrightArgs, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

process.exit(result.status ?? 1)
