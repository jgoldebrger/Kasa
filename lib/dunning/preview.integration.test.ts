import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'
import { resolveAutomationRecipients } from '@/lib/route-logic/email-automation-rules/resolve-recipients'

describe('resolveAutomationRecipients dunning_arrears', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, Family, PaymentPlan, CycleCharge, EmailTemplate, EmailAutomationRule } =
      await import('@/lib/models')
    await Promise.all([
      EmailAutomationRule.deleteMany({}),
      EmailTemplate.deleteMany({}),
      CycleCharge.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedPreviewFixture(opts?: { minOwed?: number }) {
    const { Organization, Family, PaymentPlan, CycleCharge, EmailTemplate, EmailAutomationRule } =
      await import('@/lib/models')

    const ownerId = new Types.ObjectId()
    const org = await Organization.create({
      name: 'Dunning Preview Org',
      slug: `dunning-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId,
      timezone: 'UTC',
    })

    const plan = await PaymentPlan.create({
      organizationId: org._id,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 100,
    })

    const family = await Family.create({
      organizationId: org._id,
      name: 'Cohen Family',
      weddingDate: new Date('2010-01-01'),
      email: 'cohen@example.com',
      paymentPlanId: plan._id,
    })

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    await CycleCharge.create({
      organizationId: org._id,
      familyId: family._id,
      amount: 50,
      chargeDate: fortyDaysAgo,
      cycleYear: fortyDaysAgo.getUTCFullYear(),
      calendar: 'gregorian',
    })

    const template = await EmailTemplate.create({
      organizationId: org._id,
      name: 'Arrears notice',
      subject: 'Payment reminder',
      html: '<p>Hello {{familyName}}</p>',
      text: 'Hello {{familyName}}',
      createdBy: ownerId,
    })

    const rule = await EmailAutomationRule.create({
      organizationId: org._id,
      name: 'Dunning arrears',
      enabled: true,
      templateId: template._id,
      ruleType: 'dunning_arrears',
      minOwed: opts?.minOwed ?? 100,
      daysSinceObligation: 30,
      maxAttempts: 3,
      intervalDays: 7,
    })

    return { org, family, rule }
  }

  it('counts a family who owes at least minOwed', async () => {
    const { org, rule } = await seedPreviewFixture({ minOwed: 100 })
    const preview = await resolveAutomationRecipients(String(org._id), rule)
    expect(preview.recipientCount).toBe(1)
    expect(preview.sampleFamilies).toHaveLength(1)
  })

  it('excludes a family below minOwed', async () => {
    const { org, rule } = await seedPreviewFixture({ minOwed: 10_000 })
    const preview = await resolveAutomationRecipients(String(org._id), rule)
    expect(preview.recipientCount).toBe(0)
    expect(preview.sampleFamilies).toHaveLength(0)
  })
})
