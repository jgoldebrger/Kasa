/**
 * One-time migration: encrypt legacy plaintext SMTP passwords and 2FA secrets.
 *
 * CLI entrypoint: scripts/encrypt-legacy-secrets.ts
 */

import { EmailConfig, User } from '@/lib/models'
import { encrypt, isLegacyPlaintextSecret } from '@/lib/encryption'

const LEGACY_AT_REST_FILTER = {
  $exists: true,
  $ne: '',
  $not: /^enc:v1:/,
} as const

export type MigrateLegacySecretsResult = {
  dryRun: boolean
  emailConfigs: { found: number; updated: number }
  users: { found: number; updated: number }
}

export async function migrateLegacySecrets(
  options: { dryRun?: boolean } = {},
): Promise<MigrateLegacySecretsResult> {
  const dryRun = options.dryRun ?? false

  const emailConfigDocs = await EmailConfig.find({
    password: LEGACY_AT_REST_FILTER,
  })

  let emailConfigsUpdated = 0
  for (const doc of emailConfigDocs) {
    if (!isLegacyPlaintextSecret(doc.password)) continue
    emailConfigsUpdated++
    if (!dryRun) {
      doc.password = encrypt(doc.password)
      await doc.save()
    }
  }

  const userDocs = await User.find({
    twoFactorSecret: LEGACY_AT_REST_FILTER,
  }).select('+twoFactorSecret')

  let usersUpdated = 0
  for (const user of userDocs) {
    if (!isLegacyPlaintextSecret(user.twoFactorSecret)) continue
    usersUpdated++
    if (!dryRun) {
      user.twoFactorSecret = encrypt(user.twoFactorSecret!)
      await user.save()
    }
  }

  return {
    dryRun,
    emailConfigs: { found: emailConfigDocs.length, updated: emailConfigsUpdated },
    users: { found: userDocs.length, updated: usersUpdated },
  }
}
