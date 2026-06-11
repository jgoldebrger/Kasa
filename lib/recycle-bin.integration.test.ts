import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import mongoose from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'
import type { OrgContext } from './auth-helpers'

const auditMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('./audit', () => ({
  audit: auditMock,
}))

describe('recycle-bin (integration)', () => {
  const ownerId = new mongoose.Types.ObjectId()
  const userId = new mongoose.Types.ObjectId()
  let orgId: string
  let ctx: OrgContext

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  beforeEach(async () => {
    auditMock.mockClear()
    const { Organization } = await import('./models')
    const org = await Organization.create({
      name: 'Recycle Bin Test Org',
      slug: `rb-${Date.now()}`,
      ownerId,
    })
    orgId = org._id.toString()
    ctx = {
      session: {
        user: {
          id: userId.toString(),
          email: 'admin@test.example',
          name: 'Admin',
        },
      },
      userId: userId.toString(),
      organizationId: orgId,
      role: 'owner',
    }
  })

  afterEach(async () => {
    const {
      Organization,
      Family,
      FamilyMember,
      Payment,
      PaymentPlan,
      Statement,
      Task,
      LifecycleEventPayment,
      Withdrawal,
      CycleCharge,
    } = await import('./models')
    await Promise.all([
      CycleCharge.deleteMany({}),
      Withdrawal.deleteMany({}),
      LifecycleEventPayment.deleteMany({}),
      Statement.deleteMany({}),
      Payment.deleteMany({}),
      FamilyMember.deleteMany({}),
      Task.deleteMany({}),
      Family.deleteMany({}),
      PaymentPlan.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  it('isRecyclableKind accepts known kinds and rejects unknown', async () => {
    const { isRecyclableKind } = await import('./recycle-bin')
    expect(isRecyclableKind('family')).toBe(true)
    expect(isRecyclableKind('task')).toBe(true)
    expect(isRecyclableKind('not-a-kind')).toBe(false)
    expect(isRecyclableKind('')).toBe(false)
  })

  it('softDeleteOne hides the document and records audit', async () => {
    const { Family } = await import('./models')
    const { softDeleteOne } = await import('./recycle-bin')

    const family = await Family.create({
      organizationId: orgId,
      name: 'Cohen',
      weddingDate: new Date('2010-01-01'),
    })

    const deleted = await softDeleteOne('family', family._id.toString(), ctx)
    expect(deleted).toBeTruthy()
    expect(deleted!.deletedAt).toBeTruthy()
    expect(String(deleted!.deletedBy)).toBe(userId.toString())

    const visible = await Family.findById(family._id)
    expect(visible).toBeNull()

    const inBin = await Family.findById(family._id, null, { includeDeleted: true })
    expect(inBin).toBeTruthy()
    expect(inBin!.deletedAt).toBeTruthy()

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'family.softDelete',
        organizationId: orgId,
        userId: userId.toString(),
      }),
    )
  })

  it('listTrash returns soft-deleted items with purge metadata', async () => {
    const { Task } = await import('./models')
    const { softDeleteOne, listTrash } = await import('./recycle-bin')

    const task = await Task.create({
      organizationId: orgId,
      title: 'Follow up',
      dueDate: new Date('2025-12-01'),
      email: 'admin@test.example',
    })
    const at = new Date()
    await softDeleteOne('task', task._id.toString(), ctx, { at, kind: 'manual' })

    const trash = await listTrash(orgId)
    expect(trash.totalCount).toBeGreaterThanOrEqual(1)
    expect(trash.countsByKind.task).toBe(1)
    const item = trash.items.find((i) => i.id === task._id.toString())
    expect(item).toBeTruthy()
    expect(item!.kind).toBe('task')
    expect(item!.label).toBe('Task')
    expect(item!.description).toBe('Follow up')
    expect(item!.deletedAt).toBe(at.toISOString())
    expect(item!.deletedKind).toBe('manual')
    expect(item!.daysUntilPurge).toBeGreaterThanOrEqual(1)
    expect(item!.daysUntilPurge).toBeLessThanOrEqual(30)
    expect(item!.purgesAt).toBeTruthy()
  })

  it('restoreFromBin clears deleted fields and makes the row visible again', async () => {
    const { Family } = await import('./models')
    const { softDeleteOne, restoreFromBin } = await import('./recycle-bin')

    const family = await Family.create({
      organizationId: orgId,
      name: 'Levy',
      weddingDate: new Date('2012-05-01'),
    })
    await softDeleteOne('family', family._id.toString(), ctx)

    const restored = await restoreFromBin('family', family._id.toString(), ctx)
    expect(restored).toBeTruthy()
    expect(restored!.cascadeRestored).toBe(0)

    const visible = await Family.findById(family._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
    expect(visible).toBeTruthy()
    expect(visible!.deletedAt).toBeFalsy()

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'family.restore' }),
    )
  })

  it('restoreFromBin rejects child restore when parent family is still deleted', async () => {
    const { Family, PaymentPlan, Payment } = await import('./models')
    const { softDeleteOne, restoreFromBin } = await import('./recycle-bin')

    const plan = await PaymentPlan.create({
      organizationId: orgId,
      name: 'Standard',
      planNumber: 1,
      yearlyPrice: 100,
    })
    const family = await Family.create({
      organizationId: orgId,
      name: 'Gold',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: plan._id,
    })
    const payment = await Payment.create({
      organizationId: orgId,
      familyId: family._id,
      amount: 50,
      paymentDate: new Date('2024-01-15'),
      paymentMethod: 'check',
    })

    await softDeleteOne('family', family._id.toString(), ctx, { kind: 'cascade' })
    await softDeleteOne('payment', payment._id.toString(), ctx, { kind: 'cascade' })

    await expect(restoreFromBin('payment', payment._id.toString(), ctx)).rejects.toMatchObject({
      code: 'PARENT_FAMILY_DELETED',
    })
  })

  it('purgeFromBin permanently removes a soft-deleted document', async () => {
    const { Task } = await import('./models')
    const { softDeleteOne, purgeFromBin } = await import('./recycle-bin')

    const task = await Task.create({
      organizationId: orgId,
      title: 'Purge me',
      dueDate: new Date('2025-01-01'),
      email: 'admin@test.example',
    })
    await softDeleteOne('task', task._id.toString(), ctx)

    const purged = await purgeFromBin('task', task._id.toString(), ctx)
    expect(purged).toBeTruthy()
    expect(purged!.title).toBe('Purge me')

    const gone = await Task.findById(task._id, null, { includeDeleted: true })
    expect(gone).toBeNull()

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.purge' }),
    )
  })

  it('purgeFromBin returns null when the item is not in the bin', async () => {
    const { Task } = await import('./models')
    const { purgeFromBin } = await import('./recycle-bin')

    const task = await Task.create({
      organizationId: orgId,
      title: 'Active task',
      dueDate: new Date('2025-01-01'),
      email: 'admin@test.example',
    })

    const result = await purgeFromBin('task', task._id.toString(), ctx)
    expect(result).toBeNull()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('softDeleteFamilyCascade soft-deletes family and related rows', async () => {
    const { Family, PaymentPlan, Payment, FamilyMember } = await import('./models')
    const { softDeleteFamilyCascade } = await import('./recycle-bin')

    const plan = await PaymentPlan.create({
      organizationId: orgId,
      name: 'Plan',
      planNumber: 1,
      yearlyPrice: 100,
    })
    const family = await Family.create({
      organizationId: orgId,
      name: 'Cascade Family',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: plan._id,
    })
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: family._id,
      firstName: 'A',
      lastName: 'B',
      gender: 'male',
    })
    const payment = await Payment.create({
      organizationId: orgId,
      familyId: family._id,
      amount: 10,
      paymentDate: new Date('2024-01-01'),
      paymentMethod: 'cash',
    })

    const result = await softDeleteFamilyCascade(family._id.toString(), ctx)
    expect(result).toBeTruthy()
    expect(result!.family.name).toBe('Cascade Family')

    expect(await Family.findById(family._id)).toBeNull()
    expect(await FamilyMember.findById(member._id)).toBeNull()
    expect(await Payment.findById(payment._id)).toBeNull()

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'family.softDelete',
        metadata: expect.objectContaining({
          cascade: expect.objectContaining({ memberCount: 1, paymentCount: 1 }),
        }),
      }),
    )
  })

  it('softDeleteFamilyCascade returns null when family does not exist', async () => {
    const { softDeleteFamilyCascade } = await import('./recycle-bin')

    const missingId = new mongoose.Types.ObjectId().toString()
    const result = await softDeleteFamilyCascade(missingId, ctx)
    expect(result).toBeNull()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('restoreFromBin restores cascade-deleted children when restoring family', async () => {
    const { Family, PaymentPlan, Payment, FamilyMember, Task } = await import('./models')
    const { softDeleteFamilyCascade, restoreFromBin } = await import('./recycle-bin')

    const plan = await PaymentPlan.create({
      organizationId: orgId,
      name: 'Plan',
      planNumber: 1,
      yearlyPrice: 100,
    })
    const family = await Family.create({
      organizationId: orgId,
      name: 'Restore Cascade',
      weddingDate: new Date('2010-01-01'),
      paymentPlanId: plan._id,
    })
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: family._id,
      firstName: 'Child',
      lastName: 'Member',
      gender: 'male',
    })
    const payment = await Payment.create({
      organizationId: orgId,
      familyId: family._id,
      amount: 25,
      paymentDate: new Date('2024-02-01'),
      paymentMethod: 'check',
    })
    const task = await Task.create({
      organizationId: orgId,
      title: 'Cascade task',
      dueDate: new Date('2025-03-01'),
      email: 'admin@test.example',
      relatedFamilyId: family._id,
    })

    await softDeleteFamilyCascade(family._id.toString(), ctx)

    const restored = await restoreFromBin('family', family._id.toString(), ctx)
    expect(restored).toBeTruthy()
    expect(restored!.cascadeRestored).toBeGreaterThanOrEqual(3)

    expect(await Family.findById(family._id)).toBeTruthy()
    expect(await FamilyMember.findById(member._id)).toBeTruthy()
    expect(await Payment.findById(payment._id)).toBeTruthy()
    expect(await Task.findById(task._id)).toBeTruthy()

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'family.restore',
        metadata: expect.objectContaining({ cascadeRestored: expect.any(Number) }),
      }),
    )
  })

  it('purgeAll permanently removes every soft-deleted row in the org', async () => {
    const { Family, Task } = await import('./models')
    const { softDeleteOne, purgeAll, listTrash } = await import('./recycle-bin')

    const family = await Family.create({
      organizationId: orgId,
      name: 'Purge All Family',
      weddingDate: new Date('2010-01-01'),
    })
    const task = await Task.create({
      organizationId: orgId,
      title: 'Purge All Task',
      dueDate: new Date('2025-04-01'),
      email: 'admin@test.example',
    })

    await softDeleteOne('family', family._id.toString(), ctx)
    await softDeleteOne('task', task._id.toString(), ctx)

    const counts = await purgeAll(ctx)
    expect(counts.family).toBe(1)
    expect(counts.task).toBe(1)

    const trash = await listTrash(orgId)
    expect(trash.totalCount).toBe(0)

    expect(await Family.findById(family._id, null, { includeDeleted: true })).toBeNull()
    expect(await Task.findById(task._id, null, { includeDeleted: true })).toBeNull()

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recycleBin.purgeAll',
        metadata: { counts: expect.objectContaining({ family: 1, task: 1 }) },
      }),
    )
  })

  it('listTrash returns empty for invalid org id', async () => {
    const { listTrash } = await import('./recycle-bin')
    const trash = await listTrash('not-an-object-id')
    expect(trash.items).toEqual([])
    expect(trash.totalCount).toBe(0)
  })

  it('getTrashItem returns a single bin entry', async () => {
    const { Task } = await import('./models')
    const { softDeleteOne, getTrashItem } = await import('./recycle-bin')

    const task = await Task.create({
      organizationId: orgId,
      title: 'Bin item',
      dueDate: new Date('2025-06-01'),
      email: 'admin@test.example',
    })
    await softDeleteOne('task', task._id.toString(), ctx)

    const item = await getTrashItem('task', task._id.toString(), orgId)
    expect(item).toBeTruthy()
    expect(item!.id).toBe(task._id.toString())
    expect(item!.description).toBe('Bin item')
  })
})
