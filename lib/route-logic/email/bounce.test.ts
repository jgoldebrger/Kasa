import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  updateOne: vi.fn(),
  trackDeliverabilityFailure: vi.fn(),
}))

vi.mock('@/lib/database', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/csrf', () => ({
  verifyApiCsrf: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/models', () => ({
  EmailMessage: {
    findById: mocks.findById,
    updateOne: mocks.updateOne,
  },
}))
vi.mock('@/lib/mail/deliverability', () => ({
  trackDeliverabilityFailure: mocks.trackDeliverabilityFailure,
}))

import { verifyBounceWebhookSecret } from '@/lib/route-logic/email/bounce'

const EMAIL_ID = '507f1f77bcf86cd799439011'
const WEBHOOK_SECRET = 'bounce-webhook-test-secret'

function bounceRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost/api/email/bounce', {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('verifyBounceWebhookSecret', () => {
  const prevSecret = process.env.EMAIL_BOUNCE_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.EMAIL_BOUNCE_WEBHOOK_SECRET = WEBHOOK_SECRET
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.EMAIL_BOUNCE_WEBHOOK_SECRET
    else process.env.EMAIL_BOUNCE_WEBHOOK_SECRET = prevSecret
  })

  it('returns false when secret env is unset', () => {
    delete process.env.EMAIL_BOUNCE_WEBHOOK_SECRET
    const req = new Request('http://localhost/api/email/bounce', {
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    })
    expect(verifyBounceWebhookSecret(req)).toBe(false)
  })

  it('accepts matching X-Webhook-Secret header', () => {
    const req = new Request('http://localhost/api/email/bounce', {
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    })
    expect(verifyBounceWebhookSecret(req)).toBe(true)
  })

  it('rejects wrong or missing header', () => {
    expect(
      verifyBounceWebhookSecret(
        new Request('http://localhost/api/email/bounce', {
          headers: { 'x-webhook-secret': 'wrong' },
        }),
      ),
    ).toBe(false)
    expect(verifyBounceWebhookSecret(new Request('http://localhost/api/email/bounce'))).toBe(false)
  })
})

describe('POST /api/email/bounce', () => {
  const prevSecret = process.env.EMAIL_BOUNCE_WEBHOOK_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.EMAIL_BOUNCE_WEBHOOK_SECRET = WEBHOOK_SECRET
    mocks.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: EMAIL_ID,
        organizationId: { toString: () => '507f1f77bcf86cd799439012' },
        to: 'family@example.com',
        status: 'sent',
      }),
    })
    mocks.updateOne.mockResolvedValue({ modifiedCount: 1 })
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.EMAIL_BOUNCE_WEBHOOK_SECRET
    else process.env.EMAIL_BOUNCE_WEBHOOK_SECRET = prevSecret
  })

  it('returns 401 without a valid webhook secret', async () => {
    const { POST } = await import('@/lib/route-logic/email/bounce')
    const res = await POST(bounceRequest({ emailMessageId: EMAIL_ID }))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(mocks.findById).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid emailMessageId', async () => {
    const { POST } = await import('@/lib/route-logic/email/bounce')
    const res = await POST(
      bounceRequest({ emailMessageId: 'not-an-object-id' }, { 'x-webhook-secret': WEBHOOK_SECRET }),
    )
    expect(res.status).toBe(400)
    expect(mocks.findById).not.toHaveBeenCalled()
  })

  it('returns 404 when email message is missing', async () => {
    mocks.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) })
    const { POST } = await import('@/lib/route-logic/email/bounce')
    const res = await POST(
      bounceRequest({ emailMessageId: EMAIL_ID }, { 'x-webhook-secret': WEBHOOK_SECRET }),
    )
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Email message not found' })
  })

  it('marks the message bounced and flags deliverability', async () => {
    const { POST } = await import('@/lib/route-logic/email/bounce')
    const res = await POST(
      bounceRequest(
        { emailMessageId: EMAIL_ID, reason: 'Mailbox full' },
        { 'x-webhook-secret': WEBHOOK_SECRET },
      ),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      emailMessageId: EMAIL_ID,
      status: 'bounced',
    })
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: EMAIL_ID },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'bounced', error: 'Mailbox full' }),
        $push: expect.objectContaining({
          events: expect.objectContaining({
            type: 'bounced',
            meta: { reason: 'Mailbox full' },
          }),
        }),
      }),
    )
    expect(mocks.trackDeliverabilityFailure).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439012',
      'family@example.com',
    )
  })

  it('is idempotent when message is already bounced', async () => {
    mocks.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: EMAIL_ID,
        organizationId: { toString: () => '507f1f77bcf86cd799439012' },
        to: 'family@example.com',
        status: 'bounced',
      }),
    })
    const { POST } = await import('@/lib/route-logic/email/bounce')
    const res = await POST(
      bounceRequest({ emailMessageId: EMAIL_ID }, { 'x-webhook-secret': WEBHOOK_SECRET }),
    )
    expect(res.status).toBe(200)
    expect(mocks.updateOne).not.toHaveBeenCalled()
    expect(mocks.trackDeliverabilityFailure).not.toHaveBeenCalled()
  })
})
