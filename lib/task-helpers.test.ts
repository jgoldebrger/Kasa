import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  familyLean: vi.fn(async () => null as { name?: string; email?: string } | null),
  taskCreate: vi.fn(async () => ({ _id: 'task-1' })),
  notifyAdmins: vi.fn(async () => undefined),
}))

vi.mock('./database', () => ({
  default: mocks.connectDB,
}))

vi.mock('./models', () => ({
  Family: {
    findOne: vi.fn(() => ({
      lean: mocks.familyLean,
    })),
  },
  Task: {
    create: mocks.taskCreate,
  },
}))

vi.mock('./notify', () => ({
  notifyAdmins: mocks.notifyAdmins,
}))

import { createPaymentDeclinedTask } from './task-helpers'

describe('createPaymentDeclinedTask', () => {
  const orgId = '507f1f77bcf86cd799439011'
  const familyId = '507f1f77bcf86cd799439012'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.familyLean.mockResolvedValue(null)
    mocks.taskCreate.mockResolvedValue({ _id: 'task-1' })
  })

  it('returns null when the family is not found', async () => {
    mocks.familyLean.mockResolvedValue(null)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createPaymentDeclinedTask(
      familyId,
      'pay-1',
      50,
      'card_declined',
      orgId,
    )

    expect(result).toBeNull()
    expect(mocks.connectDB).toHaveBeenCalled()
    expect(mocks.taskCreate).not.toHaveBeenCalled()
    expect(mocks.notifyAdmins).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('creates a high-priority task and notifies admins', async () => {
    mocks.familyLean.mockResolvedValue({
      name: 'Cohen Family',
      email: ' cohen@example.com ',
    })

    const result = await createPaymentDeclinedTask(
      familyId,
      'pay-1',
      100,
      'Your card was declined',
      orgId,
      'member-1',
    )

    expect(result).toEqual({ _id: 'task-1' })
    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        title: 'Payment Declined: $100',
        email: 'cohen@example.com',
        status: 'pending',
        priority: 'high',
        relatedFamilyId: familyId,
        relatedMemberId: 'member-1',
        relatedPaymentId: 'pay-1',
      }),
    )
    expect(mocks.notifyAdmins).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        kind: 'payment.failed',
        title: 'Payment declined: Cohen Family',
        link: '/tasks',
        metadata: {
          familyId,
          paymentId: 'pay-1',
          amount: 100,
        },
      }),
    )
  })

  it('uses no-email-on-file when the family has no email', async () => {
    mocks.familyLean.mockResolvedValue({ name: 'No Email Family' })

    await createPaymentDeclinedTask(familyId, null, 25, 'declined', orgId)

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'no-email-on-file',
        relatedPaymentId: undefined,
      }),
    )
  })

  it('returns null and logs when task creation throws', async () => {
    mocks.familyLean.mockResolvedValue({ name: 'Cohen Family', email: 'a@b.com' })
    mocks.taskCreate.mockRejectedValue(new Error('write failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createPaymentDeclinedTask(
      familyId,
      'pay-1',
      10,
      'declined',
      orgId,
      undefined,
      'pi_ignored',
    )

    expect(result).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
