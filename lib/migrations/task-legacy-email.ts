/**
 * Optional backfill: link legacy email-only tasks to org members when the
 * email matches a member's account. Keeps the legacy `email` field intact.
 *
 * CLI entrypoint: scripts/migrate-task-assignees.ts (if added)
 */

import { Task, OrgMembership, User } from '@/lib/models'

export type MigrateTaskAssigneesResult = {
  dryRun: boolean
  scanned: number
  updated: number
}

export async function migrateTaskAssignees(
  options: { dryRun?: boolean; organizationId?: string } = {},
): Promise<MigrateTaskAssigneesResult> {
  const dryRun = options.dryRun ?? false
  const filter: Record<string, unknown> = {
    $or: [{ assigneeUserId: { $exists: false } }, { assigneeUserId: null }],
    email: { $exists: true, $ne: '' },
  }
  if (options.organizationId) {
    filter.organizationId = options.organizationId
  }

  const tasks = await Task.find(filter)
    .select('_id organizationId email')
    .lean<{ _id: unknown; organizationId: unknown; email?: string }[]>()

  let updated = 0
  for (const task of tasks) {
    const email = task.email?.trim().toLowerCase()
    if (!email) continue

    const memberUserIds = await OrgMembership.find({
      organizationId: task.organizationId,
    }).distinct('userId')
    if (memberUserIds.length === 0) continue

    const user = await User.findOne({
      _id: { $in: memberUserIds },
      email,
    })
      .select('_id email')
      .lean<{ _id: unknown; email?: string }>()
    if (!user) continue

    const membership = await OrgMembership.findOne({
      organizationId: task.organizationId,
      userId: user._id,
    })
      .select('_id')
      .lean<{ _id: unknown }>()
    if (!membership) continue

    updated++
    if (!dryRun) {
      await Task.updateOne(
        { _id: task._id },
        {
          $set: {
            assigneeUserId: user._id,
            assigneeMembershipId: membership._id,
          },
        },
      )
    }
  }

  return { dryRun, scanned: tasks.length, updated }
}
