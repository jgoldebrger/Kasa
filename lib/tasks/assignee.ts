import { Types } from 'mongoose'
import { OrgMembership, User } from '@/lib/models'
import type { TaskBodyInput } from '@/lib/schemas/task'

export type ResolvedTaskAssignee = {
  assigneeUserId?: string
  assigneeMembershipId?: string
  email: string
}

export async function resolveTaskAssignee(
  organizationId: string,
  body: Pick<TaskBodyInput, 'assigneeMembershipId' | 'assigneeUserId' | 'email'>,
): Promise<
  { ok: true; assignee: ResolvedTaskAssignee } | { ok: false; status: number; error: string }
> {
  if (body.assigneeMembershipId) {
    if (!Types.ObjectId.isValid(body.assigneeMembershipId)) {
      return { ok: false, status: 400, error: 'Invalid assigneeMembershipId' }
    }
    const membership = await OrgMembership.findOne({
      _id: body.assigneeMembershipId,
      organizationId,
    })
      .populate('userId', 'email')
      .lean<{ _id: Types.ObjectId; userId?: { _id: Types.ObjectId; email?: string } | null }>()
    if (!membership) {
      return { ok: false, status: 404, error: 'Assignee not found in this organization' }
    }
    const userId = membership.userId?._id?.toString()
    const email = membership.userId?.email?.trim().toLowerCase()
    if (!userId || !email) {
      return { ok: false, status: 400, error: 'Assignee has no email on file' }
    }
    return {
      ok: true,
      assignee: {
        assigneeUserId: userId,
        assigneeMembershipId: body.assigneeMembershipId,
        email,
      },
    }
  }

  if (body.assigneeUserId) {
    if (!Types.ObjectId.isValid(body.assigneeUserId)) {
      return { ok: false, status: 400, error: 'Invalid assigneeUserId' }
    }
    const membership = await OrgMembership.findOne({
      userId: body.assigneeUserId,
      organizationId,
    })
      .select('_id userId')
      .lean<{ _id: Types.ObjectId }>()
    if (!membership) {
      return { ok: false, status: 404, error: 'Assignee not found in this organization' }
    }
    const user = await User.findById(body.assigneeUserId).select('email').lean<{ email?: string }>()
    const email = user?.email?.trim().toLowerCase()
    if (!email) {
      return { ok: false, status: 400, error: 'Assignee has no email on file' }
    }
    return {
      ok: true,
      assignee: {
        assigneeUserId: body.assigneeUserId,
        assigneeMembershipId: membership._id.toString(),
        email,
      },
    }
  }

  const email = body.email?.trim().toLowerCase()
  if (!email) {
    return { ok: false, status: 400, error: 'Assignee or email is required' }
  }
  return { ok: true, assignee: { email } }
}

/** Filter for tasks assigned to the current user (new assignee field + legacy email). */
export function assignedToMeFilter(userId: string, userEmail: string): Record<string, unknown> {
  const normalizedEmail = userEmail.trim().toLowerCase()
  const or: Record<string, unknown>[] = [{ assigneeUserId: userId }]
  if (normalizedEmail) {
    or.push({
      email: normalizedEmail,
      $or: [{ assigneeUserId: null }, { assigneeUserId: { $exists: false } }],
    })
  }
  return { $or: or }
}

export const TASK_ASSIGNEE_POPULATE = {
  path: 'assigneeUserId',
  select: 'name email',
} as const
