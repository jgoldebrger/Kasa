import { existsSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

const REQUIRED_DOCS = [
  'docs/STRIPE_MONEY_FLOW.md',
  'docs/NEXTAUTH_UPGRADE_POLICY.md',
  'docs/NEXTAUTH_V5_MIGRATION.md',
] as const

describe('required documentation', () => {
  for (const relativePath of REQUIRED_DOCS) {
    it(`includes ${relativePath}`, () => {
      expect(existsSync(path.join(repoRoot, relativePath))).toBe(true)
    })
  }
})
