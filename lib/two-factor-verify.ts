/**
 * Shared TOTP + backup-code verification used at login and step-up prompts.
 */

import bcrypt from 'bcryptjs'
import { User } from '@/lib/models'
import { decryptTwoFactorSecret } from '@/lib/encryption'
import { verifyTotpStep } from '@/lib/totp'

export type TwoFactorUser = {
  _id: { toString(): string }
  twoFactorSecret?: string
  twoFactorBackupCodes?: string[]
  twoFactorLastUsedStep?: number
}

/**
 * Verify a 6-digit TOTP or one-use backup code (`XXXX-XXXX`) against the user
 * record. Backup codes are consumed atomically on match.
 */
export async function verifyTwoFactorCode(user: TwoFactorUser, code: string): Promise<boolean> {
  if (!code) return false

  const digitsOnly = code.replace(/\D/g, '')
  if (digitsOnly.length === 6 && user.twoFactorSecret) {
    try {
      const secret = decryptTwoFactorSecret(user.twoFactorSecret)
      const step = verifyTotpStep(secret, digitsOnly)
      if (step !== null) {
        const updated = await User.updateOne(
          {
            _id: user._id,
            $or: [
              { twoFactorLastUsedStep: { $exists: false } },
              { twoFactorLastUsedStep: null },
              { twoFactorLastUsedStep: { $lt: step } },
            ],
          },
          { $set: { twoFactorLastUsedStep: step } },
        )
        if (updated.modifiedCount === 1) return true
        return false
      }
    } catch {
      // Fall through to backup-code path.
    }
  }

  const normalized = code.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (normalized.length >= 9 && user.twoFactorBackupCodes?.length) {
    for (const hash of user.twoFactorBackupCodes) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(normalized, hash)) {
        // eslint-disable-next-line no-await-in-loop
        const res = await User.updateOne(
          { _id: user._id, twoFactorBackupCodes: hash },
          { $pull: { twoFactorBackupCodes: hash } },
        )
        if (res.modifiedCount === 1) return true
        return false
      }
    }
  }
  return false
}
