import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'
import * as mail from '@/lib/mail'

describe('executeEmailAutomationRule dunning_arrears', () => {
  beforeAll(async () => {
    await setupMongo()
    const { DunningEpisode } = await import('@/lib/models')
    await DunningEpisode.syncIndexes()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    const {
      Organization,
      Family,
      PaymentPlan,
      Payment,
      CycleCharge,
      EmailTemplate,
      EmailAutomationRule,
      DunningEpisode,
      AuditLog,
    } = await import('@/lib/models')
    await Promise.all([
      DunningEpisode.deleteMany({}),
      EmailAutomationRule.deleteMany({}),
      EmailTemplate.deleteMany({}),
      CycleCharge.deleteMany({}),
      Payment.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
      AuditLog.deleteMany({}),
    ])
  })

  async function seedDunningFixture(opts?: { lastRunAt?: Date | null }) {
    const { Organization, Family, PaymentPlan, CycleCharge, EmailTemplate, EmailAutomationRule } =
      await import('@/lib/models')

    const ownerId = new Types.ObjectId()
    const org = await Organization.create({
      name: 'Dunning Execute Org',
      slug: `dunning-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    // calculateFamilyBalance = payments − withdrawals − cycleCharges − planCost;
    // negative net means the family owes. No payments so owed = planCost + cycle charge.
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
      minOwed: 100,
      daysSinceObligation: 30,
      maxAttempts: 3,
      intervalDays: 7,
      lastRunAt: opts?.lastRunAt ?? null,
    })

    return { org, family, rule, template }
  }

  it('sends once and records episode sendCount', async () => {
    vi.spyOn(mail, 'sleep').mockResolvedValue(undefined)
    const sendSpy = vi
      .spyOn(mail, 'sendEmail')
      .mockResolvedValue({ ok: true } as mail.SendEmailResult)

    const { org, family, rule } = await seedDunningFixture()
    const { executeEmailAutomationRule } =
      await import('@/lib/route-logic/email-automation-rules/execute-rule')
    const { DunningEpisode } = await import('@/lib/models')

    const result = await executeEmailAutomationRule(String(org._id), {
      _id: rule._id,
      templateId: rule.templateId,
      ruleType: 'dunning_arrears',
      minOwed: rule.minOwed,
      daysSinceObligation: rule.daysSinceObligation,
      maxAttempts: rule.maxAttempts,
      intervalDays: rule.intervalDays,
      lastRunAt: rule.lastRunAt,
    })

    expect(result.skipped).toBe(false)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const episode = await DunningEpisode.findOne({
      organizationId: org._id,
      familyId: family._id,
      ruleId: rule._id,
    }).lean<{ sendCount: number } | null>()
    expect(episode?.sendCount).toBe(1)
  })

  it('does not apply 24h lastRunAt gate for dunning_arrears', async () => {
    vi.spyOn(mail, 'sleep').mockResolvedValue(undefined)
    const sendSpy = vi
      .spyOn(mail, 'sendEmail')
      .mockResolvedValue({ ok: true } as mail.SendEmailResult)

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const { org, rule } = await seedDunningFixture({ lastRunAt: oneHourAgo })
    const { executeEmailAutomationRule } =
      await import('@/lib/route-logic/email-automation-rules/execute-rule')

    const result = await executeEmailAutomationRule(String(org._id), {
      _id: rule._id,
      templateId: rule.templateId,
      ruleType: 'dunning_arrears',
      minOwed: rule.minOwed,
      daysSinceObligation: rule.daysSinceObligation,
      maxAttempts: rule.maxAttempts,
      intervalDays: rule.intervalDays,
      lastRunAt: oneHourAgo,
    })

    expect(result.skipped).toBe(false)
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('still applies 24h gate for balance_gt_zero', async () => {
    vi.spyOn(mail, 'sleep').mockResolvedValue(undefined)
    const sendSpy = vi
      .spyOn(mail, 'sendEmail')
      .mockResolvedValue({ ok: true } as mail.SendEmailResult)

    const { Organization, EmailTemplate, EmailAutomationRule } = await import('@/lib/models')
    const ownerId = new Types.ObjectId()
    const org = await Organization.create({
      name: 'Balance Gate Org',
      slug: `balance-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId,
      timezone: 'UTC',
    })
    const template = await EmailTemplate.create({
      organizationId: org._id,
      name: 'Balance notice',
      subject: 'Balance',
      html: '<p>Hi</p>',
      createdBy: ownerId,
    })
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const rule = await EmailAutomationRule.create({
      organizationId: org._id,
      name: 'Balance drip',
      enabled: true,
      templateId: template._id,
      ruleType: 'balance_gt_zero',
      lastRunAt: oneHourAgo,
    })

    const { executeEmailAutomationRule } =
      await import('@/lib/route-logic/email-automation-rules/execute-rule')
    const result = await executeEmailAutomationRule(String(org._id), {
      _id: rule._id,
      templateId: rule.templateId,
      ruleType: 'balance_gt_zero',
      lastRunAt: oneHourAgo,
    })

    expect(result).toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: 'Ran within the last 24 hours',
    })
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('closes episode and skips send when payment was inserted after lastSentAt', async () => {
    vi.spyOn(mail, 'sleep').mockResolvedValue(undefined)
    const sendSpy = vi
      .spyOn(mail, 'sendEmail')
      .mockResolvedValue({ ok: true } as mail.SendEmailResult)

    const { org, family, rule } = await seedDunningFixture()
    const { DunningEpisode, Payment } = await import('@/lib/models')
    const lastSentAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await DunningEpisode.create({
      organizationId: org._id,
      familyId: family._id,
      ruleId: rule._id,
      status: 'open',
      sendCount: 1,
      lastSentAt,
    })
    await Payment.collection.insertOne({
      organizationId: org._id,
      familyId: family._id,
      amount: 1,
      paymentDate: new Date(),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { executeEmailAutomationRule } =
      await import('@/lib/route-logic/email-automation-rules/execute-rule')
    const result = await executeEmailAutomationRule(String(org._id), {
      _id: rule._id,
      templateId: rule.templateId,
      ruleType: 'dunning_arrears',
      minOwed: rule.minOwed,
      daysSinceObligation: rule.daysSinceObligation,
      maxAttempts: rule.maxAttempts,
      intervalDays: rule.intervalDays,
      lastRunAt: rule.lastRunAt,
    })

    expect(sendSpy).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
    const episode = await DunningEpisode.findOne({
      organizationId: org._id,
      familyId: family._id,
    })
    expect(episode?.status).toBe('closed')
    expect(episode?.closedReason).toBe('payment')
  })

  it('does not record sendCount when sendEmail fails', async () => {
    vi.spyOn(mail, 'sleep').mockResolvedValue(undefined)
    vi.spyOn(mail, 'sendEmail').mockResolvedValue({ ok: false } as mail.SendEmailResult)

    const { org, family, rule } = await seedDunningFixture()
    const { executeEmailAutomationRule } =
      await import('@/lib/route-logic/email-automation-rules/execute-rule')
    const { DunningEpisode } = await import('@/lib/models')

    await executeEmailAutomationRule(String(org._id), {
      _id: rule._id,
      templateId: rule.templateId,
      ruleType: 'dunning_arrears',
      minOwed: rule.minOwed,
      daysSinceObligation: rule.daysSinceObligation,
      maxAttempts: rule.maxAttempts,
      intervalDays: rule.intervalDays,
      lastRunAt: rule.lastRunAt,
    })

    const episode = await DunningEpisode.findOne({
      organizationId: org._id,
      familyId: family._id,
      ruleId: rule._id,
    }).lean<{ sendCount: number } | null>()
    expect(episode?.sendCount ?? 0).toBe(0)
  })
})
