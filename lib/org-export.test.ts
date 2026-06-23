import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Types } from 'mongoose'
import { buildOrgExportBundle } from '@/lib/org-export'

vi.mock('@/lib/models', () => ({
  Organization: { findById: vi.fn() },
  OrgMembership: { find: vi.fn() },
  User: { find: vi.fn() },
  PaymentPlan: { find: vi.fn() },
  Family: { find: vi.fn() },
  FamilyMember: { find: vi.fn() },
  Payment: { find: vi.fn() },
  Withdrawal: { find: vi.fn() },
  LifecycleEvent: { find: vi.fn() },
  LifecycleEventPayment: { find: vi.fn() },
  YearlyCalculation: { find: vi.fn() },
  Statement: { find: vi.fn() },
  EmailConfig: { findOne: vi.fn() },
  CycleConfig: { findOne: vi.fn() },
  CycleCharge: { find: vi.fn() },
  SavedPaymentMethod: { find: vi.fn() },
  RecurringPayment: { find: vi.fn() },
  Task: { find: vi.fn() },
  Notification: { find: vi.fn() },
  SavedReport: { find: vi.fn() },
  AuditLog: { find: vi.fn() },
  EmailJob: { find: vi.fn() },
  Invite: { find: vi.fn() },
}))

import { Organization, OrgMembership, User, Family, EmailConfig, CycleConfig } from '@/lib/models'

const orgId = new Types.ObjectId().toString()

function leanChain<T>(data: T[]) {
  return {
    sort: () => ({
      limit: () => ({
        lean: async () => data,
      }),
    }),
  }
}

describe('buildOrgExportBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(Organization.findById).mockReturnValue({
      lean: async () => ({ _id: orgId, name: 'Test Kehilla', slug: 'test' }),
    } as never)
    vi.mocked(OrgMembership.find).mockReturnValue({
      lean: async () => [{ userId: new Types.ObjectId(), role: 'owner' }],
    } as never)
    vi.mocked(User.find).mockReturnValue({
      select: () => ({
        lean: async () => [
          { _id: new Types.ObjectId(), email: 'treasurer@test.com', name: 'Treasurer' },
        ],
      }),
    } as never)
    vi.mocked(EmailConfig.findOne).mockReturnValue({
      lean: async () => ({ email: 'smtp@test.com', password: 'secret' }),
    } as never)
    vi.mocked(CycleConfig.findOne).mockReturnValue({
      lean: async () => null,
    } as never)

    const empty = { find: vi.fn().mockReturnValue(leanChain([])) }
    vi.mocked(Family.find).mockImplementation(empty.find)
    for (const model of [Family]) {
      void model
    }
  })

  it('returns versioned bundle with redacted email password', async () => {
    const models = await import('@/lib/models')
    for (const key of [
      'PaymentPlan',
      'FamilyMember',
      'Payment',
      'Withdrawal',
      'LifecycleEvent',
      'LifecycleEventPayment',
      'YearlyCalculation',
      'Statement',
      'CycleCharge',
      'SavedPaymentMethod',
      'RecurringPayment',
      'Task',
      'Notification',
      'SavedReport',
      'AuditLog',
      'EmailJob',
      'Invite',
    ] as const) {
      vi.mocked(models[key].find).mockReturnValue(leanChain([]) as never)
    }

    const bundle = await buildOrgExportBundle(orgId)

    expect(bundle.version).toBe('1.0')
    expect(bundle.organizationId).toBe(orgId)
    expect(bundle.organization?.name).toBe('Test Kehilla')
    expect(bundle.emailConfig?.password).toBe('[REDACTED]')
    expect(bundle.users[0].password).toBeUndefined()
  })
})
