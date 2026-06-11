/**
 * Hoisted network mocks for API route integration tests.
 * Loaded via vitest.api.config.ts setupFiles (after vitest.setup.ts).
 */
import { vi } from 'vitest'

const stripeMocks = vi.hoisted(() => {
  const constructEvent = vi.fn((rawBody: string | Buffer, _sig: string, _secret: string) => {
    const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
    const parsed = JSON.parse(text) as { id?: string; type?: string; data?: unknown }
    if (parsed?.id && parsed?.type) {
      return parsed
    }
    return {
      id: `evt_api_probe_${Date.now()}`,
      type: 'customer.created',
      data: { object: {} },
    }
  })

  const charges = {
    retrieve: vi.fn(async () => ({
      id: 'ch_probe',
      payment_intent: 'pi_apiprobemock',
      amount_refunded: 0,
      currency: 'usd',
    })),
  }

  const paymentIntents = {
    create: vi.fn(async () => ({
      id: 'pi_apiprobemock',
      client_secret: 'pi_apiprobemock_secret',
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      payment_method: 'pm_probemock',
      metadata: {
        organizationId: process.env.KASA_TEST_STRIPE_ORG || '',
        familyId: process.env.KASA_TEST_STRIPE_FAMILY || '',
      },
    })),
    retrieve: vi.fn(async (id: string) => ({
      id,
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      payment_method: 'pm_probemock',
      metadata: {
        organizationId: process.env.KASA_TEST_STRIPE_ORG || '',
        familyId: process.env.KASA_TEST_STRIPE_FAMILY || '',
      },
    })),
    confirm: vi.fn(async (id: string) => ({
      id,
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
    })),
  }

  const paymentMethods = {
    retrieve: vi.fn(async () => ({
      id: 'pm_probemock',
      card: {
        last4: '4242',
        brand: 'visa',
        exp_month: 12,
        exp_year: 2030,
      },
      billing_details: { name: 'Probe User' },
    })),
  }

  const StripeCtor = vi.fn(function Stripe(this: unknown) {
    return {
      webhooks: { constructEvent },
      paymentIntents,
      paymentMethods,
      charges,
    }
  })

  return { constructEvent, paymentIntents, StripeCtor }
})

vi.mock('stripe', () => ({
  default: stripeMocks.StripeCtor,
}))

const mailMocks = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({ messageId: 'api-probe-mock' }))
  const verify = vi.fn(async () => true)
  const close = vi.fn(async () => undefined)
  const createTransport = vi.fn(() => ({ sendMail, verify, close }))
  return { sendMail, verify, close, createTransport }
})

vi.mock('nodemailer', () => ({
  default: { createTransport: mailMocks.createTransport },
}))

vi.mock('pdf-lib', () => {
  const mockFont = {
    widthOfTextAtSize: vi.fn((text: string, size: number) => Math.max(1, text.length) * size * 0.5),
  }
  const page = {
    drawText: vi.fn(),
    getSize: () => ({ width: 612, height: 792 }),
  }
  const doc = {
    addPage: vi.fn(() => page),
    embedFont: vi.fn(async () => mockFont),
    save: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  }
  return {
    PDFDocument: {
      create: vi.fn(async () => doc),
    },
    rgb: vi.fn(() => ({ r: 0, g: 0, b: 0 })),
    StandardFonts: {
      Helvetica: 'Helvetica',
      HelveticaBold: 'Helvetica-Bold',
    },
  }
})

vi.mock('@/lib/email-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-utils')>()
  const probePdf = Buffer.from('%PDF-1.4 api-route-probe')
  return {
    ...actual,
    generateStatementPDF: vi.fn(async () => probePdf),
    generateTaxReceiptPDF: vi.fn(async () => probePdf),
  }
})

vi.mock('@/lib/email-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-jobs')>()
  return {
    ...actual,
    kickoffEmailWorker: vi.fn(async () => ({ ok: true as const })),
  }
})

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 999, resetAt: 0 })),
  }
})

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return {
    ...actual,
    audit: vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/platform-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-admin')>()
  return {
    ...actual,
    assertPlatformAdminTwoFactor: vi.fn(async () => null),
  }
})

