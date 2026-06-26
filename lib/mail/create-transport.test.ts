import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendMail, verify, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({}))
  const verify = vi.fn(async () => true)
  const createTransport = vi.fn(() => ({ sendMail, verify }))
  return { sendMail, verify, createTransport }
})

vi.mock('nodemailer', () => ({
  default: { createTransport },
}))

import {
  createGmailTransport,
  createTransportWithFallback,
  normalizeTransportCreds,
  verifyGmailCreds,
} from './create-transport'

describe('create-transport', () => {
  beforeEach(() => {
    sendMail.mockClear()
    verify.mockClear()
    createTransport.mockClear()
    delete process.env.ORG_SMTP_FALLBACK_HOST
  })

  it('normalizes Gmail app passwords', () => {
    expect(normalizeTransportCreds({ email: ' a@b.com ', password: 'ab cd ef' })).toEqual({
      email: 'a@b.com',
      password: 'abcdef',
    })
  })

  it('creates Gmail transport on port 465 with timeouts', () => {
    createGmailTransport({ email: 'a@gmail.com', password: 'secret' }, { port: 465 })
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        connectionTimeout: 10_000,
      }),
    )
  })

  it('verifies Gmail creds on 587 when 465 fails', async () => {
    verify.mockRejectedValueOnce(new Error('465 timeout')).mockResolvedValueOnce(true)
    await verifyGmailCreds({ email: 'a@gmail.com', password: 'secret' })
    expect(verify).toHaveBeenCalledTimes(2)
    expect(createTransport).toHaveBeenNthCalledWith(1, expect.objectContaining({ port: 465 }))
    expect(createTransport).toHaveBeenNthCalledWith(2, expect.objectContaining({ port: 587 }))
  })

  it('retries sendMail on port 587 when 465 fails', async () => {
    sendMail
      .mockRejectedValueOnce(new Error('465 timeout'))
      .mockResolvedValueOnce({ messageId: 'ok' })

    const transport = createTransportWithFallback({ email: 'a@gmail.com', password: 'secret' })
    await transport.sendMail({ to: 'x@y.com', subject: 'hi' })

    expect(sendMail).toHaveBeenCalledTimes(2)
    expect(createTransport).toHaveBeenCalledTimes(2)
  })
})
