import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '../test/mongo-memory'

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({}))
  const createTransport = vi.fn(() => ({ sendMail }))
  return { sendMail, createTransport }
})

vi.mock('nodemailer', () => ({
  default: { createTransport },
}))

describe('sendOneFamilyTaxReceipt (integration)', () => {
  const ownerId = new Types.ObjectId()
  let orgId: Types.ObjectId
  let familyId: Types.ObjectId
  const taxYear = 2024

  const emailConfig = {
    email: 'sender@test.example',
    password: 'app-password',
    fromName: 'Test Org',
  }

  beforeAll(async () => {
    await setupMongo()
    orgId = new Types.ObjectId()
    familyId = new Types.ObjectId()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    sendMail.mockClear()
    createTransport.mockClear()
    const { Organization, Family, Payment } = await import('../models')
    await Promise.all([
      Payment.deleteMany({}),
      Family.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedOrgAndFamily(opts?: {
    email?: string | null
    emailOptOut?: boolean
    withOrg?: boolean
  }) {
    const { Organization, Family } = await import('../models')
    if (opts?.withOrg !== false) {
      await Organization.create({
        _id: orgId,
        name: 'Receipt Test Org',
        slug: `rcpt-org-${orgId.toString().slice(-6)}`,
        ownerId,
        locale: 'en-US',
        currency: 'USD',
      })
    }
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Levy Family',
      weddingDate: new Date('2010-01-01'),
      email: opts && 'email' in opts ? opts.email : 'levy@example.com',
      emailOptOut: opts?.emailOptOut ?? false,
      street: '1 Main St',
      city: 'Town',
      state: 'NY',
      zip: '10001',
    })
  }

  async function seedMembershipPayment(amount: number, refundedAmount = 0) {
    const { Payment } = await import('../models')
    await Payment.create({
      organizationId: orgId,
      familyId,
      amount,
      refundedAmount,
      paymentDate: new Date(`${taxYear}-03-15T12:00:00.000Z`),
      year: taxYear,
      type: 'membership',
      paymentMethod: 'check',
    })
  }

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: orgId.toString(),
      familyId: familyId.toString(),
      year: taxYear,
      config: emailConfig,
      ...overrides,
    }
  }

  it('returns family not found for unknown family', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedOrgAndFamily()

    const result = await sendOneFamilyTaxReceipt({
      ...baseInput(),
      familyId: new Types.ObjectId().toString(),
    })

    expect(result).toEqual({ ok: false, email: null, error: 'Family not found' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns opted-out when family has emailOptOut', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedOrgAndFamily({ emailOptOut: true })

    const result = await sendOneFamilyTaxReceipt(baseInput())

    expect(result).toEqual({
      ok: false,
      email: 'levy@example.com',
      error: 'Family opted out of bulk emails',
    })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns no email on file when family has no address', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedOrgAndFamily({ email: null })

    const result = await sendOneFamilyTaxReceipt(baseInput())

    expect(result).toEqual({ ok: false, email: null, error: 'No email on file' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns organization not found when org row is missing', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedOrgAndFamily({ withOrg: false })

    const result = await sendOneFamilyTaxReceipt(baseInput())

    expect(result).toEqual({
      ok: false,
      email: 'levy@example.com',
      error: 'Organization not found',
    })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns error when no membership-dues payments exist for the year', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedOrgAndFamily()

    const result = await sendOneFamilyTaxReceipt(baseInput())

    expect(result).toEqual({
      ok: false,
      email: 'levy@example.com',
      totalPaid: 0,
      error: `No membership-dues payments recorded for ${taxYear}`,
    })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('falls back to en-US/USD when org locale or currency is invalid', async () => {
    const { Organization } = await import('../models')
    await seedOrgAndFamily()
    await Organization.updateOne(
      { _id: orgId },
      { $set: { locale: 'not-a-real-locale', currency: 'NOTREAL' } },
    )

    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedMembershipPayment(75)

    const transporter = { sendMail } as any
    const result = await sendOneFamilyTaxReceipt({ ...baseInput(), transporter })

    expect(result.ok).toBe(true)
    const mail = (sendMail.mock.calls as unknown as unknown[][])[0]?.[0] as unknown as { text: string; html: string }
    expect(mail.text).toMatch(/\$75\.00/)
    expect(mail.html).toContain('$75.00')
  })

  it('sends tax receipt email when payments exist', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    await seedOrgAndFamily()
    await seedMembershipPayment(200, 50)

    const transporter = { sendMail } as any
    const result = await sendOneFamilyTaxReceipt({ ...baseInput(), transporter })

    expect(result).toEqual({
      ok: true,
      email: 'levy@example.com',
      totalPaid: 150,
    })
    expect(sendMail).toHaveBeenCalledTimes(1)

    const mail = (sendMail.mock.calls as unknown as unknown[][])[0]?.[0] as unknown as {
      to: string
      subject: string
      attachments: Array<{ filename: string; contentType: string }>
    }
    expect(mail.to).toBe('levy@example.com')
    expect(mail.subject).toContain(`Tax Receipt for ${taxYear}`)
    expect(mail.attachments[0].filename).toContain(`Tax_Receipt_`)
    expect(mail.attachments[0].contentType).toBe('application/pdf')
  })

  it('reports send failures without throwing', async () => {
    const { sendOneFamilyTaxReceipt } = await import('./send-receipt')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await seedOrgAndFamily()
    await seedMembershipPayment(100)

    sendMail.mockRejectedValueOnce(new Error('SMTP timeout'))

    const result = await sendOneFamilyTaxReceipt({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    expect(result.ok).toBe(false)
    expect(result.email).toBe('levy@example.com')
    expect(result.totalPaid).toBe(100)
    expect(result.error).toBe('SMTP timeout')
    consoleSpy.mockRestore()
  })
})
