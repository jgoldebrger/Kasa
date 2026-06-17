import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'
import { EmailConfig, User } from '@/lib/models'
import { encrypt, isLegacyPlaintextSecret, ENCRYPTION_PREFIX } from '@/lib/encryption'
import { migrateLegacySecrets } from './encrypt-legacy-secrets'

describe('isLegacyPlaintextSecret', () => {
  it('detects non-empty values without enc:v1: prefix', () => {
    expect(isLegacyPlaintextSecret('plain-smtp-password')).toBe(true)
    expect(isLegacyPlaintextSecret(`${ENCRYPTION_PREFIX}iv:tag:ct`)).toBe(false)
    expect(isLegacyPlaintextSecret('')).toBe(false)
    expect(isLegacyPlaintextSecret(null)).toBe(false)
  })
})

describe('migrateLegacySecrets (integration)', () => {
  const orgId = new mongoose.Types.ObjectId()

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'migration-test-encryption-key-32b'
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    await EmailConfig.deleteMany({})
    await User.deleteMany({})
  })

  it('dry-run reports counts without persisting ciphertext', async () => {
    await EmailConfig.create({
      organizationId: orgId,
      email: 'smtp@example.com',
      password: 'legacy-smtp-password',
    })
    await User.create({
      email: '2fa-user@example.com',
      name: '2FA User',
      hashedPassword: await bcrypt.hash('password', 10),
      twoFactorSecret: 'LEGACYTOTPSECRETBASE32',
    })

    const result = await migrateLegacySecrets({ dryRun: true })

    expect(result).toEqual({
      dryRun: true,
      emailConfigs: { found: 1, updated: 1 },
      users: { found: 1, updated: 1 },
    })

    const emailDoc = await EmailConfig.findOne({ organizationId: orgId })
    const userDoc = await User.findOne({ email: '2fa-user@example.com' }).select('+twoFactorSecret')
    expect(emailDoc?.password).toBe('legacy-smtp-password')
    expect(userDoc?.twoFactorSecret).toBe('LEGACYTOTPSECRETBASE32')
  })

  it('encrypts legacy rows and is idempotent on re-run', async () => {
    await EmailConfig.create({
      organizationId: orgId,
      email: 'smtp@example.com',
      password: 'legacy-smtp-password',
    })
    await User.create({
      email: '2fa-user@example.com',
      name: '2FA User',
      hashedPassword: await bcrypt.hash('password', 10),
      twoFactorSecret: 'LEGACYTOTPSECRETBASE32',
    })

    const first = await migrateLegacySecrets({ dryRun: false })
    expect(first.emailConfigs.updated).toBe(1)
    expect(first.users.updated).toBe(1)

    const emailDoc = await EmailConfig.findOne({ organizationId: orgId })
    const userDoc = await User.findOne({ email: '2fa-user@example.com' }).select('+twoFactorSecret')
    expect(emailDoc?.password.startsWith(ENCRYPTION_PREFIX)).toBe(true)
    expect(userDoc?.twoFactorSecret?.startsWith(ENCRYPTION_PREFIX)).toBe(true)
    expect(encrypt('legacy-smtp-password')).not.toBe(emailDoc?.password)

    const second = await migrateLegacySecrets({ dryRun: false })
    expect(second.emailConfigs).toEqual({ found: 0, updated: 0 })
    expect(second.users).toEqual({ found: 0, updated: 0 })
  })

  it('skips already-encrypted values', async () => {
    const cipher = encrypt('already-encrypted')
    await EmailConfig.create({
      organizationId: orgId,
      email: 'smtp@example.com',
      password: cipher,
    })

    const result = await migrateLegacySecrets({ dryRun: false })
    expect(result.emailConfigs).toEqual({ found: 0, updated: 0 })
    expect(result.users).toEqual({ found: 0, updated: 0 })
  })
})
