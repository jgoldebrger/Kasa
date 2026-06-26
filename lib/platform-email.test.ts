import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({}))
  const createTransport = vi.fn(() => ({ sendMail }))
  return { sendMail, createTransport }
})

vi.mock('nodemailer', () => ({
  default: { createTransport },
}))

import {
  isPlatformEmailConfigured,
  notifyPlatformAdminsOfInviteRequest,
  sendPlatformEmail,
} from './platform-email'

const SMTP_ENV_KEYS = [
  'PLATFORM_SMTP_HOST',
  'PLATFORM_SMTP_PORT',
  'PLATFORM_SMTP_USER',
  'PLATFORM_SMTP_PASS',
  'PLATFORM_SMTP_FROM',
  'PLATFORM_SMTP_SECURE',
] as const

function setConfiguredSmtp(overrides: Record<string, string | undefined> = {}) {
  const base = {
    PLATFORM_SMTP_HOST: 'smtp.example.com',
    PLATFORM_SMTP_PORT: '587',
    PLATFORM_SMTP_USER: 'user',
    PLATFORM_SMTP_PASS: 'pass',
    PLATFORM_SMTP_FROM: 'Kasa <noreply@example.com>',
    PLATFORM_SMTP_SECURE: 'false',
  }
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    process.env[key] = value
  }
}

describe('isPlatformEmailConfigured', () => {
  const prev: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of SMTP_ENV_KEYS) {
      prev[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of SMTP_ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  })

  it('returns false when any required env var is missing', () => {
    expect(isPlatformEmailConfigured()).toBe(false)
    process.env.PLATFORM_SMTP_HOST = 'smtp.example.com'
    expect(isPlatformEmailConfigured()).toBe(false)
  })

  it('returns true when all required env vars are set', () => {
    setConfiguredSmtp()
    expect(isPlatformEmailConfigured()).toBe(true)
  })
})

describe('sendPlatformEmail', () => {
  const prev: Record<string, string | undefined> = {}

  beforeEach(() => {
    sendMail.mockClear()
    createTransport.mockClear()
    for (const key of SMTP_ENV_KEYS) {
      prev[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of SMTP_ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  })

  it('returns not configured when SMTP env is missing', async () => {
    const result = await sendPlatformEmail({
      to: 'admin@example.com',
      subject: 'Hello',
      text: 'body',
    })
    expect(result).toEqual({ sent: false, reason: 'platform SMTP not configured' })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('returns invalid port when PLATFORM_SMTP_PORT is not numeric', async () => {
    setConfiguredSmtp({ PLATFORM_SMTP_PORT: 'not-a-port' })
    const result = await sendPlatformEmail({
      to: 'admin@example.com',
      subject: 'Hello',
    })
    expect(result).toEqual({ sent: false, reason: 'invalid PLATFORM_SMTP_PORT' })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('sends mail when configured', async () => {
    setConfiguredSmtp()
    const result = await sendPlatformEmail({
      to: 'admin@example.com',
      subject: 'Subject\r\nInjection',
      text: 'plain',
      html: '<p>html</p>',
    })
    expect(result).toEqual({ sent: true })
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'user', pass: 'pass' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Kasa <noreply@example.com>',
      to: 'admin@example.com',
      subject: 'Subject Injection',
      text: 'plain',
      html: '<p>html</p>',
    })
  })

  it('strips spaces from Gmail app passwords', async () => {
    setConfiguredSmtp({ PLATFORM_SMTP_PASS: 'abcd efgh ijkl mnop' })
    const result = await sendPlatformEmail({
      to: 'admin@example.com',
      subject: 'Hello',
      text: 'body',
    })
    expect(result).toEqual({ sent: true })
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'user', pass: 'abcdefghijklmnop' },
      }),
    )
  })

  it('returns send failed when transport throws', async () => {
    setConfiguredSmtp()
    sendMail.mockRejectedValueOnce(new Error('SMTP connection refused'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await sendPlatformEmail({
      to: 'admin@example.com',
      subject: 'Hello',
      text: 'body',
    })

    expect(result.sent).toBe(false)
    expect(result.error).toContain('SMTP connection refused')
    expect(errSpy).toHaveBeenCalledWith('[platform-email] send failed:', 'SMTP connection refused')
    errSpy.mockRestore()
  })
})

describe('notifyPlatformAdminsOfInviteRequest', () => {
  const prev: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of [...SMTP_ENV_KEYS, 'PLATFORM_ADMIN_EMAILS', 'NEXTAUTH_URL']) {
      prev[key] = process.env[key]
      delete process.env[key]
    }
    sendMail.mockClear()
    createTransport.mockClear()
  })

  afterEach(() => {
    for (const key of [...SMTP_ENV_KEYS, 'PLATFORM_ADMIN_EMAILS', 'NEXTAUTH_URL']) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  })

  it('warns and skips when SMTP is not configured', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@example.com'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await notifyPlatformAdminsOfInviteRequest({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[request-invite] Platform SMTP not configured; admin notification not sent.',
    )
    expect(createTransport).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('warns and skips when admin emails are not configured', async () => {
    setConfiguredSmtp()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await notifyPlatformAdminsOfInviteRequest({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[request-invite] PLATFORM_ADMIN_EMAILS not configured; admin notification not sent.',
    )
    expect(createTransport).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('emails all platform admins with request details', async () => {
    setConfiguredSmtp()
    process.env.PLATFORM_ADMIN_EMAILS = 'admin1@example.com, admin2@example.com'
    process.env.NEXTAUTH_URL = 'https://kasa.example.com'

    await notifyPlatformAdminsOfInviteRequest({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      orgName: 'Example Org',
    })

    expect(sendMail).toHaveBeenCalledTimes(2)
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin1@example.com',
        subject: 'New Kasa signup request from Ada Lovelace',
        text: expect.stringContaining('Organization: Example Org'),
        html: expect.stringContaining('https://kasa.example.com/admin/invite-requests'),
      }),
    )
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin2@example.com',
      }),
    )
  })
})
