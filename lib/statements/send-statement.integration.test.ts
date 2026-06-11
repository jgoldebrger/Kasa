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

describe('sendOneFamilyStatement (integration)', () => {
  const ownerId = new Types.ObjectId()
  let orgId: Types.ObjectId
  let familyId: Types.ObjectId
  let planId: Types.ObjectId

  const emailConfig = {
    email: 'sender@test.example',
    password: 'app-password',
    fromName: 'Test Org',
  }

  const fromDate = new Date('2024-06-01T00:00:00.000Z')
  const toDate = new Date('2024-06-30T23:59:59.999Z')

  beforeAll(async () => {
    await setupMongo()
    orgId = new Types.ObjectId()
    familyId = new Types.ObjectId()
    planId = new Types.ObjectId()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    sendMail.mockClear()
    createTransport.mockClear()
    const { Organization, Family, PaymentPlan, Payment, Statement, Counter } =
      await import('../models')
    await Promise.all([
      Statement.deleteMany({}),
      Payment.deleteMany({}),
      Counter.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedFamily(opts?: { email?: string | null }) {
    const { Organization, PaymentPlan, Family } = await import('../models')
    await Organization.create({
      _id: orgId,
      name: 'Statement Test Org',
      slug: `stmt-org-${orgId.toString().slice(-6)}`,
      ownerId,
      locale: 'en-US',
      currency: 'USD',
    })
    await PaymentPlan.create({
      _id: planId,
      organizationId: orgId,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 500,
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Cohen Family',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: planId,
      email: opts && 'email' in opts ? opts.email : 'cohen@example.com',
    })
  }

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: orgId.toString(),
      familyId: familyId.toString(),
      fromDate,
      toDate,
      config: emailConfig,
      ...overrides,
    }
  }

  it('returns family not found for unknown family', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    await seedFamily()

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      familyId: new Types.ObjectId().toString(),
    })

    expect(result).toEqual({ ok: false, email: null, error: 'Family not found' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns no email on file when family has no address', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    await seedFamily({ email: null })

    const result = await sendOneFamilyStatement(baseInput())

    expect(result).toEqual({ ok: false, email: null, error: 'No email on file' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends statement email and creates one Statement row per period', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Statement } = await import('../models')
    await seedFamily()

    const transporter = { sendMail } as any
    const first = await sendOneFamilyStatement({ ...baseInput(), transporter })
    const second = await sendOneFamilyStatement({ ...baseInput(), transporter })

    expect(first).toEqual({ ok: true, email: 'cohen@example.com' })
    expect(second).toEqual({ ok: true, email: 'cohen@example.com' })
    expect(sendMail).toHaveBeenCalledTimes(2)

    const statements = await Statement.find({
      organizationId: orgId,
      familyId,
    }).lean()
    expect(statements).toHaveLength(1)
    expect(statements[0].statementNumber).toMatch(/^STMT-/)

    const mail = (sendMail.mock.calls as unknown as unknown[][])[0]?.[0] as unknown as {
      to: string
      subject: string
      attachments: Array<{ contentType: string }>
    }
    expect(mail.to).toBe('cohen@example.com')
    expect(mail.subject).toContain('Monthly Statement')
    expect(mail.attachments[0].contentType).toBe('application/pdf')
  })

  it('reuses an existing Statement for the same period (idempotent)', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Statement } = await import('../models')
    await seedFamily()

    const existing = await Statement.create({
      organizationId: orgId,
      familyId,
      statementNumber: 'STMT-LEGACY-1',
      date: new Date(),
      fromDate,
      toDate,
      openingBalance: 0,
      income: 10,
      withdrawals: 0,
      expenses: 0,
      cycleCharges: 0,
      closingBalance: 10,
    })

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    expect(result.ok).toBe(true)
    const statements = await Statement.find({ organizationId: orgId, familyId })
    expect(statements).toHaveLength(1)
    expect(statements[0]._id.toString()).toBe(existing._id.toString())
    expect(statements[0].statementNumber).toBe('STMT-LEGACY-1')
  })

  it('reports send failures without throwing', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    await seedFamily()

    sendMail.mockRejectedValueOnce(new Error('SMTP down'))

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    expect(result.ok).toBe(false)
    expect(result.email).toBe('cohen@example.com')
    expect(result.error).toBe('SMTP down')
  })

  it('creates nodemailer transport when none is passed', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    await seedFamily()

    const result = await sendOneFamilyStatement(baseInput())

    expect(result.ok).toBe(true)
    expect(createTransport).toHaveBeenCalledWith({
      service: 'gmail',
      auth: { user: emailConfig.email, pass: emailConfig.password },
    })
    expect(sendMail).toHaveBeenCalled()
  })

  it('includes annual dues line when cycle charges are present', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { CycleCharge } = await import('../models')
    await seedFamily()

    await CycleCharge.create({
      organizationId: orgId,
      familyId,
      amount: 500,
      chargeDate: new Date('2024-06-10'),
      cycleYear: 2024,
      calendar: 'gregorian',
      planName: 'Standard',
    })

    await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    const mail = (sendMail.mock.calls as unknown as unknown[][]).at(-1)?.[0] as unknown as { text: string; html: string }
    expect(mail.text).toContain('Annual Dues Charged')
    expect(mail.html).toContain('Annual Dues Charged')
  })

  it('falls back to en-US formatting when org locale is invalid', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Organization } = await import('../models')
    await seedFamily()
    await Organization.updateOne(
      { _id: orgId },
      { $set: { locale: 'not-a-real-locale', currency: 'NOTREAL' } },
    )

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    expect(result.ok).toBe(true)
    const mail = (sendMail.mock.calls as unknown as unknown[][]).at(-1)?.[0] as unknown as { text: string }
    expect(mail.text).toMatch(/\$[\d,.]+/)
  })

  it('returns an error when statement create fails with a non-duplicate error', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Statement } = await import('../models')
    await seedFamily()

    const createSpy = vi.spyOn(Statement, 'create').mockImplementationOnce(async () => {
      throw new Error('write failed')
    })

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    createSpy.mockRestore()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/write failed/)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('falls back to en-US when the org locale is invalid in the email body', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Organization } = await import('../models')
    await seedFamily()
    await Organization.updateOne(
      { _id: orgId },
      { $set: { locale: 'invalid-locale-tag', currency: 'USD' } },
    )

    const localeSpy = vi
      .spyOn(Date.prototype, 'toLocaleDateString')
      .mockImplementation(function (this: Date, locales?: string | string[]) {
        if (locales === 'invalid-locale-tag') {
          throw new RangeError('invalid language tag')
        }
        return new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(this)
      })

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    localeSpy.mockRestore()
    expect(result.ok).toBe(true)
    const mail = (sendMail.mock.calls as unknown as unknown[][]).at(-1)?.[0] as unknown as { text: string }
    expect(mail.text).toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/)
  })

  it('recovers from duplicate-key races by reusing the existing statement', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Statement } = await import('../models')
    await seedFamily()

    const createSpy = vi.spyOn(Statement, 'create').mockImplementationOnce(async (doc) => {
      await Statement.collection.insertOne({
        ...doc,
        organizationId: orgId,
        familyId,
        fromDate,
        toDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      throw Object.assign(new Error('duplicate'), { code: 11000 })
    })

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    createSpy.mockRestore()
    expect(result.ok).toBe(true)
    expect(sendMail).toHaveBeenCalled()
    const statements = await Statement.find({ organizationId: orgId, familyId })
    expect(statements).toHaveLength(1)
  })

  it('surfaces duplicate-key errors when the existing row cannot be found', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const { Statement } = await import('../models')
    await seedFamily()

    const createSpy = vi.spyOn(Statement, 'create').mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate'), { code: 11000 })
    })

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    createSpy.mockRestore()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/duplicate/)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns an error when the statement row disappears after update', async () => {
    const { sendOneFamilyStatement } = await import('./send-statement')
    const models = await import('../models')
    await seedFamily()

    const updateSpy = vi
      .spyOn(models.Statement, 'findOneAndUpdate')
      .mockResolvedValueOnce(null as never)

    const result = await sendOneFamilyStatement({
      ...baseInput(),
      transporter: { sendMail } as any,
    })

    updateSpy.mockRestore()
    expect(result).toEqual({
      ok: false,
      email: 'cohen@example.com',
      error: 'Statement record missing after update',
    })
    expect(sendMail).not.toHaveBeenCalled()
  })
})
