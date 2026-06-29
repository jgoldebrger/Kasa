import { OrgMembership, User, Invite } from '@/lib/models'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { z } from 'zod'
import { objectId, role as roleSchema } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'

// GET /api/org-members — list members + pending invites.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/org-members',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-members-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const [memberships, invites] = await Promise.all([
      loadAllByIdCursor<any>(
        (filter, limit) =>
          OrgMembership.find(filter)
            .populate('userId', 'name email')
            .sort({ createdAt: 1, _id: 1 })
            .limit(limit)
            .lean<any[]>(),
        { organizationId: ctx!.organizationId },
      ),
      loadAllByIdCursor<any>(
        (filter, limit) =>
          Invite.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean<any[]>(),
        {
          organizationId: ctx!.organizationId,
          acceptedAt: null,
          expiresAt: { $gt: new Date() },
        },
      ),
    ])

    return {
      data: {
        members: memberships.map((m) => ({
          membershipId: m._id.toString(),
          userId: m.userId?._id?.toString() || null,
          name: m.userId?.name || '(deleted user)',
          email: m.userId?.email || '',
          role: m.role,
          joinedAt: m.createdAt,
        })),
        invites: invites.map((i) => ({
          id: i._id.toString(),
          email: i.email,
          role: i.role,
          invitedAt: i.createdAt,
          expiresAt: i.expiresAt,
        })),
        currentUserId: ctx!.userId,
        currentUserRole: ctx!.role,
      },
    }
  },
})

const patchBody = z.object({
  membershipId: objectId,
  role: roleSchema,
})

// PATCH /api/org-members — change a member's role.
export const PATCH = handler({
  auth: 'org',
  minRole: 'admin',
  body: patchBody,
  name: 'PATCH /api/org-members',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-members-patch',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if (body.role === 'owner' && ctx!.role !== 'owner') {
      return { status: 403, data: { error: 'Only owners can promote to owner' } }
    }
    if (
      (body.role === 'treasurer' || body.role === 'communications') &&
      ctx!.role !== 'owner' &&
      ctx!.role !== 'admin'
    ) {
      return { status: 403, data: { error: 'Only admins can assign specialist roles' } }
    }

    const membership = await OrgMembership.findOne({
      _id: body.membershipId,
      organizationId: ctx!.organizationId,
    })
    if (!membership) return { status: 404, data: { error: 'Membership not found' } }

    if (membership.role === 'owner' && ctx!.role !== 'owner') {
      return { status: 403, data: { error: 'Only owners can change an owner\u2019s role' } }
    }

    if (membership.userId?.toString() === ctx!.userId) {
      return { status: 400, data: { error: 'You cannot change your own role' } }
    }

    if (membership.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await OrgMembership.countDocuments({
        organizationId: ctx!.organizationId,
        role: 'owner',
      })
      if (ownerCount <= 1) {
        return { status: 400, data: { error: 'Cannot demote the last owner' } }
      }
    }

    const oldRole = membership.role
    membership.role = body.role
    await membership.save()

    // Race guard: the pre-check above is correct in isolation but two
    // admins demoting two different owners at the same instant could
    // both see `ownerCount = 2` and both demote, leaving the org with
    // ZERO owners and effectively locking it out. Recount AFTER the
    // save; if we just removed the last owner, revert this change.
    // Mongo transactions aren't used elsewhere in this codebase so we
    // use the optimistic post-check pattern.
    if (oldRole === 'owner' && body.role !== 'owner') {
      const remainingOwners = await OrgMembership.countDocuments({
        organizationId: ctx!.organizationId,
        role: 'owner',
      })
      if (remainingOwners === 0) {
        membership.role = oldRole
        await membership.save()
        return {
          status: 409,
          data: {
            error:
              'Demotion would leave the organization without an owner — another admin may have just demoted the last remaining owner. Please retry.',
          },
        }
      }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'membership.role-change',
      resourceType: 'OrgMembership',
      resourceId: membership._id,
      metadata: { from: oldRole, to: body.role, targetUserId: membership.userId?.toString() },
      request,
    })

    return { data: { ok: true, role: membership.role } }
  },
})

const deleteQuery = z.object({ id: objectId })

// DELETE /api/org-members?id=xxx — remove a member.
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  query: deleteQuery,
  name: 'DELETE /api/org-members',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-members-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const membership = await OrgMembership.findOne({
      _id: query.id,
      organizationId: ctx!.organizationId,
    })
    if (!membership) return { status: 404, data: { error: 'Membership not found' } }

    if (membership.userId?.toString() === ctx!.userId) {
      return { status: 400, data: { error: 'You cannot remove yourself; ask another admin' } }
    }

    if (membership.role === 'owner' && ctx!.role !== 'owner') {
      return { status: 403, data: { error: 'Only owners can remove other owners' } }
    }
    if (membership.role === 'owner') {
      const ownerCount = await OrgMembership.countDocuments({
        organizationId: ctx!.organizationId,
        role: 'owner',
      })
      if (ownerCount <= 1) {
        return { status: 400, data: { error: 'Cannot remove the last owner' } }
      }
    }

    // Snapshot the doc BEFORE deleting so we can revert if a concurrent
    // removal races us through the count check. Same race as the PATCH
    // demote path: two admins removing two different owners at the same
    // instant could both see `ownerCount = 2` and both delete, locking
    // the org out. We revert by re-creating the membership with the
    // original _id when our delete is the one that crossed the line.
    const wasOwner = membership.role === 'owner'
    const snapshot = wasOwner ? membership.toObject() : null

    await membership.deleteOne()

    if (wasOwner) {
      const remainingOwners = await OrgMembership.countDocuments({
        organizationId: ctx!.organizationId,
        role: 'owner',
      })
      if (remainingOwners === 0 && snapshot) {
        // Restore. Keep the same _id and createdAt so the user's
        // membership row "never went away" from any caller's
        // perspective.
        await OrgMembership.create(snapshot).catch((err) => {
          // If the revert itself fails we're in a bad state, but
          // logging is the best we can do without transactions.
          // eslint-disable-next-line no-console
          console.error('[org-members] failed to revert concurrent owner removal', err)
        })
        return {
          status: 409,
          data: {
            error:
              'Removal would leave the organization without an owner — another admin may have just removed the last remaining owner. Please retry.',
          },
        }
      }
    }

    // Clear the user's active-org cookie target if it pointed here.
    await User.updateMany(
      { _id: membership.userId, lastActiveOrganizationId: membership.organizationId },
      { $unset: { lastActiveOrganizationId: 1 } },
    )

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'membership.remove',
      resourceType: 'OrgMembership',
      resourceId: membership._id,
      metadata: { role: membership.role, targetUserId: membership.userId?.toString() },
      request,
    })

    return { data: { ok: true } }
  },
})
